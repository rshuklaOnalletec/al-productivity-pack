/**
 * Resolves UI captions to AL source field names by parsing .al page files.
 * 
 * In BC Page Scripting YAML, the `field:` target uses the AL source field name
 * (e.g., "Buy-from Vendor Name"), not the UI caption (e.g., "Vendor Name").
 * 
 * This module scans AL page source files and builds a lookup map:
 *   { PageName → { caption → fieldSourceName, partName → subformPageName } }
 */

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';

export interface PageFieldInfo {
    /** Map: lowercase caption → field source name */
    captionToField: Map<string, string>;
    /** Map: lowercase field source name → field source name (for passthrough) */
    fieldNames: Map<string, string>;
    /** Map: part name → subform page name */
    parts: Map<string, string>;
}

export class FieldResolver {
    private pages: Map<string, PageFieldInfo> = new Map();
    private initialized = false;

    async initialize(searchPaths?: string[]): Promise<void> {
        this.pages.clear();

        // Read searchPaths from settings if not provided
        const config = vscode.workspace.getConfiguration('alProductivityPack');
        const configuredPaths: string[] = searchPaths || config.get<string[]>('searchPaths', []);

        // 1. Scan workspace .al files
        const alFiles = await this.findAlPageFiles(configuredPaths);
        for (const file of alFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                this.parsePageFile(text);
            } catch {
                // Skip unreadable files
            }
        }

        // 2. Scan .alpackages/*.app files (ZIP archives with AL source)
        await this.scanAlPackages();

        this.initialized = true;
        console.log(`[ALP] Field resolver initialized: ${this.pages.size} pages indexed from ${alFiles.length} workspace files + .alpackages`);
    }

    /**
     * Resolve a user-provided field name (could be caption or source name) to
     * the actual AL source field name for a given page.
     */
    resolveField(pageName: string, userFieldName: string): string {
        if (!this.initialized) {
            return userFieldName;
        }

        const pageInfo = this.pages.get(pageName.toLowerCase());
        if (!pageInfo) {
            return userFieldName;
        }

        const lowerInput = userFieldName.toLowerCase();

        // First try exact field name match (passthrough)
        const exactField = pageInfo.fieldNames.get(lowerInput);
        if (exactField) {
            return exactField;
        }

        // Then try caption → field name resolution
        const resolved = pageInfo.captionToField.get(lowerInput);
        if (resolved) {
            return resolved;
        }

        // No match — return as-is
        return userFieldName;
    }

    /**
     * Check if a field name can be confidently resolved for a page.
     * Returns true if it's a known field name or caption.
     */
    isFieldKnown(pageName: string, userFieldName: string): boolean {
        const pageInfo = this.pages.get(pageName.toLowerCase());
        if (!pageInfo) {
            return false;
        }
        const lower = userFieldName.toLowerCase();
        return pageInfo.fieldNames.has(lower) || pageInfo.captionToField.has(lower);
    }

    /**
     * Returns true if the resolver has indexed a given page (has AL source for it).
     */
    isPageKnown(pageName: string): boolean {
        return this.pages.has(pageName.toLowerCase());
    }

    /**
     * Get the subform page name for a part on a given page.
     */
    resolvePartSubform(pageName: string, partName: string): string | undefined {
        const pageInfo = this.pages.get(pageName.toLowerCase());
        if (!pageInfo) {
            return undefined;
        }
        return pageInfo.parts.get(partName);
    }

    /**
     * Get available part names for a page.
     */
    getPartNames(pageName: string): string[] {
        const pageInfo = this.pages.get(pageName.toLowerCase());
        if (!pageInfo) {
            return [];
        }
        return Array.from(pageInfo.parts.keys());
    }

    /**
     * Get all known field names for a page (source names).
     */
    getFieldNames(pageName: string): string[] {
        const pageInfo = this.pages.get(pageName.toLowerCase());
        if (!pageInfo) {
            return [];
        }
        return Array.from(pageInfo.fieldNames.values());
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    getPageCount(): number {
        return this.pages.size;
    }

    private async findAlPageFiles(searchPaths?: string[]): Promise<vscode.Uri[]> {
        const results: vscode.Uri[] = [];

        // Search workspace folders (excluding .alpackages — handled separately)
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(folder, '**/*.Page.al');
                const files = await vscode.workspace.findFiles(pattern, '**/{node_modules,.alpackages}/**');
                results.push(...files);
            }
        }

        // Search additional paths (e.g., base app source folder)
        if (searchPaths) {
            for (const searchPath of searchPaths) {
                const uri = vscode.Uri.file(searchPath);
                const pattern = new vscode.RelativePattern(uri, '**/*.Page.al');
                const files = await vscode.workspace.findFiles(pattern);
                results.push(...files);
            }
        }

        return results;
    }

    /**
     * Scan .alpackages folders in all workspace folders for .app files (ZIP archives).
     * Extracts *.Page.al entries and parses them for field info.
     */
    private async scanAlPackages(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        for (const folder of workspaceFolders) {
            // Find .app files in .alpackages at root
            const alpackagesDirs = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '.alpackages/*.app'), undefined, 50
            );

            // Also check subfolder projects
            const subfolderApps = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/.alpackages/*.app'), undefined, 50
            );
            const allApps = [...alpackagesDirs, ...subfolderApps];

            // Deduplicate and prefer the latest version of Base Application
            const appPaths = new Set<string>();
            let latestBaseApp = '';
            for (const app of allApps) {
                const basename = path.basename(app.fsPath);
                if (basename.startsWith('Microsoft_Base Application_')) {
                    // Pick the latest by version string
                    if (basename > path.basename(latestBaseApp)) {
                        latestBaseApp = app.fsPath;
                    }
                } else {
                    appPaths.add(app.fsPath);
                }
            }
            if (latestBaseApp) {
                appPaths.add(latestBaseApp);
            }

            // Extract Page.al files from each .app (ZIP archive)
            for (const appPath of appPaths) {
                try {
                    this.extractPagesFromApp(appPath);
                } catch {
                    // Skip unreadable .app files
                }
            }
        }
    }

    /**
     * Extract Page.al files from a .app ZIP archive and parse them.
     * Uses a single unzip call to extract all page sources at once for speed.
     */
    private extractPagesFromApp(appPath: string): void {
        let content = '';
        try {
            content = execSync(
                `unzip -p "${appPath}" "src/*.Page.al" 2>/dev/null`,
                { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
            );
        } catch (err: any) {
            // unzip may exit non-zero but still produce valid stdout
            if (err?.stdout) {
                content = err.stdout;
            } else {
                // Try alternative path pattern
                try {
                    content = execSync(
                        `unzip -p "${appPath}" "*.Page.al" 2>/dev/null`,
                        { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
                    );
                } catch (err2: any) {
                    content = err2?.stdout || '';
                }
            }
        }

        if (!content || content.length < 100) {
            return;
        }

        // Split concatenated output by page declarations
        const pageBlocks = content.split(/(?=^page\s+\d+\s+)/m);

        for (const block of pageBlocks) {
            if (block.trim().length > 50) {
                this.parsePageFile(block);
            }
        }
    }

    private parsePageFile(text: string): void {
        // Extract page name: page XXXX "Page Name" or page XXXX PageName
        const pageMatch = text.match(/^page\s+\d+\s+"([^"]+)"/m)
            || text.match(/^page\s+\d+\s+(\w+)/m);
        if (!pageMatch) {
            return;
        }

        const pageName = pageMatch[1];
        const pageInfo: PageFieldInfo = {
            captionToField: new Map(),
            fieldNames: new Map(),
            parts: new Map()
        };

        // Two-pass approach for robustness:
        // Pass 1: Find all field declarations to register field names
        // Handles both quoted: field("No."; Rec."No.") and unquoted: field(Name; Rec.Name)
        const fieldDeclRegex = /field\((?:"([^"]+)"|(\w+));\s*[^)]*\)/g;
        let declMatch: RegExpExecArray | null;
        const fieldPositions: { name: string; pos: number }[] = [];

        while ((declMatch = fieldDeclRegex.exec(text)) !== null) {
            const fieldName = declMatch[1] || declMatch[2];
            pageInfo.fieldNames.set(fieldName.toLowerCase(), fieldName);
            fieldPositions.push({ name: fieldName, pos: declMatch.index });
        }

        // Pass 2: For each field declaration, look ahead for Caption = '...'
        // (within the next field or section boundary)
        for (let i = 0; i < fieldPositions.length; i++) {
            const start = fieldPositions[i].pos;
            const end = i + 1 < fieldPositions.length ? fieldPositions[i + 1].pos : start + 2000;
            const chunk = text.slice(start, Math.min(end, start + 2000));

            const captionMatch = chunk.match(/Caption\s*=\s*'([^']+)'/);
            if (captionMatch) {
                pageInfo.captionToField.set(captionMatch[1].toLowerCase(), fieldPositions[i].name);
            }
        }

        // Extract parts: part(PartName; "Subform Page Name")
        const partRegex = /part\((\w+);\s*"([^"]+)"\)/g;
        let partMatch: RegExpExecArray | null;

        while ((partMatch = partRegex.exec(text)) !== null) {
            const partName = partMatch[1];
            const subformPage = partMatch[2];
            pageInfo.parts.set(partName, subformPage);
        }

        this.pages.set(pageName.toLowerCase(), pageInfo);
    }
}

/** Singleton instance for extension lifetime */
let resolverInstance: FieldResolver | undefined;

export function getFieldResolver(): FieldResolver {
    if (!resolverInstance) {
        resolverInstance = new FieldResolver();
    }
    return resolverInstance;
}
