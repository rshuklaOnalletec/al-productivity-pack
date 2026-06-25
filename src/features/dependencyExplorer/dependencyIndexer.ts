import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ALField, ALExtension, ALReference } from '../../types';
import { parseDependencies } from '../../utils/dependencyParser';

const INDEX_FILE = '.alp-index/dependencies.json';

export class DependencyIndexer {
    private fields: ALField[] = [];
    private extensions: ALExtension[] = [];
    private references: ALReference[] = [];
    private isIndexing = false;

    /**
     * Try to load a previously saved index from disk. Returns true if loaded successfully.
     */
    async loadFromCache(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return false; }

        const cacheFile = path.join(workspaceFolders[0].uri.fsPath, INDEX_FILE);
        if (!fs.existsSync(cacheFile)) { return false; }

        try {
            const raw = fs.readFileSync(cacheFile, 'utf8');
            const data = JSON.parse(raw);
            if (data.fields && data.extensions && data.references) {
                this.fields = data.fields;
                this.extensions = data.extensions;
                this.references = data.references;
                console.log(`AL Dependency Index: Loaded cached index (${this.fields.length} fields, ${this.extensions.length} extensions, ${this.references.length} references)`);
                return true;
            }
        } catch { /* corrupt cache — will re-index */ }
        return false;
    }

    /**
     * Save the current index to disk.
     */
    private saveToCache(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return; }

        const cacheDir = path.join(workspaceFolders[0].uri.fsPath, '.alp-index');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const cacheFile = path.join(cacheDir, 'dependencies.json');
        fs.writeFileSync(cacheFile, JSON.stringify({
            fields: this.fields,
            extensions: this.extensions,
            references: this.references,
            timestamp: Date.now()
        }), 'utf8');
    }

    async indexWorkspace(): Promise<void> {
        if (this.isIndexing) {
            return;
        }

        this.isIndexing = true;
        this.fields = [];
        this.extensions = [];
        this.references = [];

        try {
            const config = vscode.workspace.getConfiguration('alProductivityPack');
            const additionalPaths = config.get<string[]>('searchPaths', []);

            // Workspace files (your project)
            const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,node_modules}/**');

            // Dependency files (from search paths)
            let depFiles: vscode.Uri[] = [];
            for (const searchPath of additionalPaths) {
                const pattern = new vscode.RelativePattern(searchPath, '**/*.al');
                const files = await vscode.workspace.findFiles(pattern);
                depFiles = depFiles.concat(files);
            }

            // Also include .alpackages
            if (config.get<boolean>('includeBaseApp', true)) {
                const pkgFiles = await vscode.workspace.findFiles('**/.alpackages/**/*.al');
                depFiles = depFiles.concat(pkgFiles);
            }

            const depPaths = new Set(depFiles.map(f => f.fsPath));
            const allFiles = [...alFiles, ...depFiles];

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'AL Productivity Pack: Indexing dependencies...',
                    cancellable: false
                },
                async (progress) => {
                    const total = allFiles.length;
                    for (let i = 0; i < allFiles.length; i++) {
                        const file = allFiles[i];
                        const source = depPaths.has(file.fsPath) ? 'dependency' : 'workspace';
                        const projectName = this.extractProjectName(file.fsPath);

                        progress.report({
                            increment: (1 / total) * 100,
                            message: `${i + 1}/${total} files`
                        });

                        try {
                            const document = await vscode.workspace.openTextDocument(file);
                            const content = document.getText();
                            const result = parseDependencies(content, file.fsPath);

                            this.fields.push(...result.fields.map(f => ({ ...f, source: source as 'workspace' | 'dependency' })));
                            this.extensions.push(...result.extensions.map(e => ({ ...e, source: source as 'workspace' | 'dependency' })));
                            this.references.push(...result.references.map(r => ({
                                ...r,
                                source: source as 'workspace' | 'dependency',
                                projectName
                            })));
                        } catch {
                            // Skip unreadable files
                        }
                    }
                }
            );

            console.log(`AL Dependency Index: ${this.fields.length} fields, ${this.extensions.length} extensions, ${this.references.length} references`);
            this.saveToCache();
        } finally {
            this.isIndexing = false;
        }
    }

    // Get all extensions that target a specific object
    getExtensionsForObject(objectName: string): ALExtension[] {
        return this.extensions.filter(e =>
            e.targetObject.toLowerCase() === objectName.toLowerCase()
        );
    }

    // Get all fields declared in a specific object (table/tableextension)
    getFieldsForObject(objectName: string): ALField[] {
        return this.fields.filter(f =>
            f.objectName.toLowerCase() === objectName.toLowerCase()
        );
    }

    // Find where a field is referenced across all projects
    getFieldReferences(fieldName: string): ALReference[] {
        return this.references.filter(r =>
            r.referenceType === 'field' &&
            r.targetName.toLowerCase() === fieldName.toLowerCase()
        );
    }

    // Find where a table is referenced
    getTableReferences(tableName: string): ALReference[] {
        return this.references.filter(r =>
            r.referenceType === 'table' &&
            r.targetName.toLowerCase() === tableName.toLowerCase()
        );
    }

    // Find where a codeunit/page/etc is referenced
    getObjectReferences(objectName: string): ALReference[] {
        return this.references.filter(r =>
            (r.referenceType === 'codeunit' || r.referenceType === 'page' ||
             r.referenceType === 'enum' || r.referenceType === 'procedure') &&
            r.targetName.toLowerCase() === objectName.toLowerCase()
        );
    }

    // Get all unique objects that are extended by other projects
    getExtendedObjects(): { objectName: string; extensionCount: number; extensions: ALExtension[] }[] {
        const map = new Map<string, ALExtension[]>();
        for (const ext of this.extensions) {
            const key = ext.targetObject;
            const existing = map.get(key) || [];
            existing.push(ext);
            map.set(key, existing);
        }

        return [...map.entries()].map(([objectName, exts]) => ({
            objectName,
            extensionCount: exts.length,
            extensions: exts
        }));
    }

    // Get all unique objects referenced from other projects
    getReferencedObjects(): { objectName: string; refCount: number; references: ALReference[] }[] {
        const map = new Map<string, ALReference[]>();
        for (const ref of this.references) {
            if (ref.referenceType === 'table' || ref.referenceType === 'codeunit' ||
                ref.referenceType === 'page' || ref.referenceType === 'enum') {
                const key = ref.targetName;
                const existing = map.get(key) || [];
                existing.push(ref);
                map.set(key, existing);
            }
        }

        return [...map.entries()].map(([objectName, refs]) => ({
            objectName,
            refCount: refs.length,
            references: refs
        }));
    }

    getAllFields(): ALField[] {
        return this.fields;
    }

    getAllExtensions(): ALExtension[] {
        return this.extensions;
    }

    getAllReferences(): ALReference[] {
        return this.references;
    }

    private extractProjectName(filePath: string): string {
        const parts = filePath.split('/');
        const knownSubfolders = ['src', 'AL', 'Codeunits', 'Pages', 'Tables', 'Page Extensions', 'Table Extensions'];
        for (let i = parts.length - 2; i >= 0; i--) {
            if (knownSubfolders.includes(parts[i])) {
                if (i > 0) {
                    return parts[i - 1];
                }
            }
        }
        if (parts.length >= 3) {
            return parts[parts.length - 3];
        }
        return '';
    }
}
