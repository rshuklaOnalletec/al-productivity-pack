import * as vscode from 'vscode';
import { DependencyIndexer } from './dependencyIndexer';
import { EventIndexer } from '../eventSubscriberFinder/eventIndexer';
import { SubscriberMapper } from '../eventSubscriberFinder/subscriberMapper';

type NodeType = 'summary' | 'category' | 'object' | 'field' | 'extension' | 'reference';

interface DependencyNodeData {
    nodeType: NodeType;
    objectName?: string;
    fieldName?: string;
    category?: string;
    filePath?: string;
    line?: number;
}

export class DependencyTreeProvider implements vscode.TreeDataProvider<DependencyNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DependencyNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private dependencyIndexer: DependencyIndexer,
        private eventIndexer: EventIndexer,
        private subscriberMapper: SubscriberMapper
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DependencyNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DependencyNode): Thenable<DependencyNode[]> {
        if (!element) {
            return Promise.resolve(this.getRootCategories());
        }

        const data = element.data;

        if (data.nodeType === 'category') {
            switch (data.category) {
                case 'tables': return Promise.resolve(this.getTableObjects());
                case 'codeunits': return Promise.resolve(this.getCodeunitObjects());
                case 'pages': return Promise.resolve(this.getPageObjects());
                case 'extensions': return Promise.resolve(this.getExtensionsList());
            }
        }

        if (data.nodeType === 'object' && data.category === 'tables') {
            return Promise.resolve(this.getTableDetails(data.objectName!));
        }

        if (data.nodeType === 'object' && data.category === 'codeunits') {
            return Promise.resolve(this.getCodeunitDetails(data.objectName!));
        }

        if (data.nodeType === 'object' && data.category === 'pages') {
            return Promise.resolve(this.getPageDetails(data.objectName!));
        }

        if (data.nodeType === 'extension' && data.objectName) {
            return Promise.resolve(this.getExtensionChildren(data.objectName));
        }

        if (data.nodeType === 'field') {
            return Promise.resolve(this.getFieldReferences(data.fieldName!));
        }

        return Promise.resolve([]);
    }

    private getRootCategories(): DependencyNode[] {
        const extensions = this.dependencyIndexer.getAllExtensions();
        const references = this.dependencyIndexer.getAllReferences();
        const fields = this.dependencyIndexer.getAllFields();

        // Summary node
        const summary = new DependencyNode(
            `${fields.length} fields · ${extensions.length} extensions · ${references.length} cross-refs`,
            '',
            vscode.TreeItemCollapsibleState.None,
            { nodeType: 'summary' }
        );
        summary.iconPath = new vscode.ThemeIcon('dashboard');

        const tables = new DependencyNode(
            'Tables & Fields',
            `${this.getWorkspaceTableCount()} tables`,
            vscode.TreeItemCollapsibleState.Collapsed,
            { nodeType: 'category', category: 'tables' }
        );
        tables.iconPath = new vscode.ThemeIcon('database');

        const codeunits = new DependencyNode(
            'Codeunits',
            `${this.getWorkspaceCodeunitCount()} codeunits`,
            vscode.TreeItemCollapsibleState.Collapsed,
            { nodeType: 'category', category: 'codeunits' }
        );
        codeunits.iconPath = new vscode.ThemeIcon('symbol-method');

        const pages = new DependencyNode(
            'Pages',
            `${this.getWorkspacePageCount()} pages`,
            vscode.TreeItemCollapsibleState.Collapsed,
            { nodeType: 'category', category: 'pages' }
        );
        pages.iconPath = new vscode.ThemeIcon('browser');

        const extNode = new DependencyNode(
            'Extensions (who extends what)',
            `${extensions.length} extensions found`,
            vscode.TreeItemCollapsibleState.Collapsed,
            { nodeType: 'category', category: 'extensions' }
        );
        extNode.iconPath = new vscode.ThemeIcon('extensions');

        return [summary, tables, codeunits, pages, extNode];
    }

    private getTableObjects(): DependencyNode[] {
        const objects = this.eventIndexer.getAllObjects();
        const tables = this.deduplicateObjects(
            objects.filter(o => o.objectType.toLowerCase() === 'table')
        );

        return tables.map(table => {
            const tableProject = this.extractProject(table.filePath);
            const fieldCount = this.dependencyIndexer.getFieldsForObject(table.objectName).length;
            const refCount = this.getCrossProjectRefs(
                this.dependencyIndexer.getTableReferences(table.objectName), tableProject
            ).length;
            const extCount = this.dependencyIndexer.getExtensionsForObject(table.objectName).length;

            const parts: string[] = [];
            if (fieldCount > 0) { parts.push(`${fieldCount} fields`); }
            if (extCount > 0) { parts.push(`${extCount} ext`); }
            if (refCount > 0) { parts.push(`${refCount} refs`); }

            const hasActivity = refCount > 0 || extCount > 0;

            const node = new DependencyNode(
                `${table.objectType} ${table.objectId} "${table.objectName}"`,
                parts.join(' · ') || 'no external usage',
                vscode.TreeItemCollapsibleState.Collapsed,
                { nodeType: 'object', objectName: table.objectName, category: 'tables' }
            );
            node.iconPath = hasActivity
                ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
                : new vscode.ThemeIcon('circle-large-outline');
            return node;
        }).sort((a, b) => (a.label as string).localeCompare(b.label as string));
    }

    private getTableDetails(objectName: string): DependencyNode[] {
        const nodes: DependencyNode[] = [];

        // Extensions targeting this table
        const extensions = this.dependencyIndexer.getExtensionsForObject(objectName);
        if (extensions.length > 0) {
            const extNode = new DependencyNode(
                `Extended by (${extensions.length})`,
                extensions.map(e => this.extractProject(e.filePath)).filter((v, i, a) => a.indexOf(v) === i).join(', '),
                vscode.TreeItemCollapsibleState.Expanded,
                { nodeType: 'extension', objectName: objectName }
            );
            extNode.iconPath = new vscode.ThemeIcon('git-merge');
            nodes.push(extNode);
        }

        // Table references from other projects
        const objectProject = this.extractProject(
            this.eventIndexer.getAllObjects().find(o => o.objectName === objectName)?.filePath || ''
        );
        const refs = this.getCrossProjectRefs(
            this.dependencyIndexer.getTableReferences(objectName), objectProject
        );
        if (refs.length > 0) {
            const projects = [...new Set(refs.map(r => r.projectName))].filter(p => p);
            const refNode = new DependencyNode(
                `Referenced by (${projects.length} project${projects.length > 1 ? 's' : ''})`,
                projects.join(', '),
                vscode.TreeItemCollapsibleState.None,
                { nodeType: 'summary' }
            );
            refNode.iconPath = new vscode.ThemeIcon('references');
            nodes.push(refNode);
        }

        // Fields in this table
        const fields = this.dependencyIndexer.getFieldsForObject(objectName);
        for (const field of fields) {
            const fieldProject = this.extractProject(field.filePath);
            const fieldRefs = this.getCrossProjectRefs(
                this.dependencyIndexer.getFieldReferences(field.fieldName), fieldProject
            );
            const desc = fieldRefs.length > 0
                ? `${field.dataType} · used in ${fieldRefs.length} place(s)`
                : `${field.dataType}`;

            const fieldNode = new DependencyNode(
                `"${field.fieldName}"`,
                desc,
                fieldRefs.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                { nodeType: 'field', fieldName: field.fieldName, filePath: field.filePath, line: field.line }
            );
            fieldNode.iconPath = fieldRefs.length > 0
                ? new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('testing.iconPassed'))
                : new vscode.ThemeIcon('symbol-field');

            if (fieldRefs.length === 0) {
                fieldNode.command = {
                    command: 'vscode.open',
                    title: 'Open Field',
                    arguments: [vscode.Uri.file(field.filePath), { selection: new vscode.Range(field.line, 0, field.line, 0) }]
                };
            }
            nodes.push(fieldNode);
        }

        return nodes;
    }

    private getFieldReferences(fieldName: string): DependencyNode[] {
        const refs = this.dependencyIndexer.getFieldReferences(fieldName);
        return refs.map(ref => {
            const fileName = ref.filePath.split('/').pop() || '';
            const node = new DependencyNode(
                ref.projectName || fileName,
                fileName,
                vscode.TreeItemCollapsibleState.None,
                { nodeType: 'reference', filePath: ref.filePath, line: ref.line }
            );
            node.iconPath = new vscode.ThemeIcon('arrow-right');
            node.command = {
                command: 'vscode.open',
                title: 'Open Reference',
                arguments: [vscode.Uri.file(ref.filePath), { selection: new vscode.Range(ref.line, 0, ref.line, 0) }]
            };
            node.tooltip = new vscode.MarkdownString(`**${ref.projectName}**\n\n\`${ref.context}\`\n\n*${ref.filePath}:${ref.line + 1}*`);
            return node;
        });
    }

    private getCodeunitObjects(): DependencyNode[] {
        const objects = this.eventIndexer.getAllObjects();
        const codeunits = this.deduplicateObjects(
            objects.filter(o => o.objectType.toLowerCase() === 'codeunit')
        );

        return codeunits.map(cu => {
            const cuProject = this.extractProject(cu.filePath);
            const refs = this.getCrossProjectRefs(
                this.dependencyIndexer.getObjectReferences(cu.objectName), cuProject
            );
            const events = this.eventIndexer.getAllEvents().filter(e => e.objectName === cu.objectName);
            const subscribers = events.reduce((sum, e) => {
                return sum + (this.subscriberMapper.findAllSubscribersForEvent(cu.objectName, e.eventName)).length;
            }, 0);

            const parts: string[] = [];
            if (events.length > 0) { parts.push(`${events.length} events`); }
            if (subscribers > 0) { parts.push(`${subscribers} subs`); }
            if (refs.length > 0) { parts.push(`${refs.length} refs`); }

            const hasActivity = refs.length > 0 || subscribers > 0;

            const node = new DependencyNode(
                `${cu.objectType} ${cu.objectId} "${cu.objectName}"`,
                parts.join(' · ') || 'no external usage',
                vscode.TreeItemCollapsibleState.Collapsed,
                { nodeType: 'object', objectName: cu.objectName, category: 'codeunits' }
            );
            node.iconPath = hasActivity
                ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
                : new vscode.ThemeIcon('circle-large-outline');
            return node;
        }).sort((a, b) => (a.label as string).localeCompare(b.label as string));
    }

    private getCodeunitDetails(objectName: string): DependencyNode[] {
        const nodes: DependencyNode[] = [];

        // Object references from other projects
        const cuProject = this.extractProject(
            this.eventIndexer.getAllObjects().find(o => o.objectName === objectName)?.filePath || ''
        );
        const refs = this.getCrossProjectRefs(
            this.dependencyIndexer.getObjectReferences(objectName), cuProject
        );
        if (refs.length > 0) {
            const projects = [...new Set(refs.map(r => r.projectName))].filter(p => p);
            for (const project of projects) {
                const projectRefs = refs.filter(r => r.projectName === project);
                const node = new DependencyNode(
                    `Referenced by: ${project}`,
                    `${projectRefs.length} reference(s)`,
                    vscode.TreeItemCollapsibleState.None,
                    { nodeType: 'reference', filePath: projectRefs[0].filePath, line: projectRefs[0].line }
                );
                node.iconPath = new vscode.ThemeIcon('arrow-right');
                node.command = {
                    command: 'vscode.open',
                    title: 'Open',
                    arguments: [vscode.Uri.file(projectRefs[0].filePath), { selection: new vscode.Range(projectRefs[0].line, 0, projectRefs[0].line, 0) }]
                };
                nodes.push(node);
            }
        }

        // Events and subscribers
        const events = this.eventIndexer.getAllEvents().filter(e => e.objectName === objectName);
        if (events.length > 0) {
            const eventSummary = new DependencyNode(
                `Events (${events.length})`,
                events.filter(e => this.subscriberMapper.findAllSubscribersForEvent(objectName, e.eventName).length > 0).length + ' subscribed',
                vscode.TreeItemCollapsibleState.None,
                { nodeType: 'summary' }
            );
            eventSummary.iconPath = new vscode.ThemeIcon('symbol-event');
            nodes.push(eventSummary);
        }

        return nodes;
    }

    private getPageObjects(): DependencyNode[] {
        const objects = this.eventIndexer.getAllObjects();
        const pages = this.deduplicateObjects(
            objects.filter(o => o.objectType.toLowerCase() === 'page')
        );

        return pages.map(page => {
            const pageProject = this.extractProject(page.filePath);
            const extCount = this.dependencyIndexer.getExtensionsForObject(page.objectName).length;
            const refs = this.getCrossProjectRefs(
                this.dependencyIndexer.getObjectReferences(page.objectName), pageProject
            );

            const parts: string[] = [];
            if (extCount > 0) { parts.push(`${extCount} ext`); }
            if (refs.length > 0) { parts.push(`${refs.length} refs`); }

            const hasActivity = extCount > 0 || refs.length > 0;

            const node = new DependencyNode(
                `${page.objectType} ${page.objectId} "${page.objectName}"`,
                parts.join(' · ') || 'no external usage',
                vscode.TreeItemCollapsibleState.Collapsed,
                { nodeType: 'object', objectName: page.objectName, category: 'pages' }
            );
            node.iconPath = hasActivity
                ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
                : new vscode.ThemeIcon('circle-large-outline');
            return node;
        }).sort((a, b) => (a.label as string).localeCompare(b.label as string));
    }

    private getPageDetails(objectName: string): DependencyNode[] {
        const nodes: DependencyNode[] = [];

        const extensions = this.dependencyIndexer.getExtensionsForObject(objectName);
        for (const ext of extensions) {
            const project = this.extractProject(ext.filePath);
            const node = new DependencyNode(
                `Extended by: ${ext.extensionName}`,
                project,
                vscode.TreeItemCollapsibleState.None,
                { nodeType: 'extension', filePath: ext.filePath, line: ext.line }
            );
            node.iconPath = new vscode.ThemeIcon('git-merge');
            node.command = {
                command: 'vscode.open',
                title: 'Open Extension',
                arguments: [vscode.Uri.file(ext.filePath), { selection: new vscode.Range(ext.line, 0, ext.line, 0) }]
            };
            nodes.push(node);
        }

        return nodes;
    }

    private getExtensionsList(): DependencyNode[] {
        const extended = this.dependencyIndexer.getExtendedObjects();
        return extended
            .sort((a, b) => b.extensionCount - a.extensionCount)
            .map(item => {
                const projects = [...new Set(item.extensions.map(e => this.extractProject(e.filePath)))].filter(p => p);
                const node = new DependencyNode(
                    `"${item.objectName}"`,
                    `${item.extensionCount} extension(s) from: ${projects.join(', ')}`,
                    vscode.TreeItemCollapsibleState.None,
                    { nodeType: 'summary' }
                );
                node.iconPath = new vscode.ThemeIcon('git-merge');
                return node;
            });
    }

    /**
     * Get references that come from a DIFFERENT project folder than the object's own project.
     */
    private getCrossProjectRefs<T extends { projectName: string; filePath: string }>(refs: T[], objectProject: string): T[] {
        if (!objectProject) { return refs; }
        return refs.filter(r => {
            const refProject = r.projectName || this.extractProject(r.filePath);
            return refProject && refProject !== objectProject;
        });
    }

    private getExtensionChildren(objectName: string): DependencyNode[] {
        const extensions = this.dependencyIndexer.getExtensionsForObject(objectName);
        return extensions.map(ext => {
            const project = this.extractProject(ext.filePath);
            const fileName = ext.filePath.split('/').pop() || '';
            const node = new DependencyNode(
                `${ext.extensionType} ${ext.extensionId} "${ext.extensionName}"`,
                project || fileName,
                vscode.TreeItemCollapsibleState.None,
                { nodeType: 'reference', filePath: ext.filePath, line: ext.line }
            );
            node.iconPath = new vscode.ThemeIcon('git-merge');
            node.command = {
                command: 'vscode.open',
                title: 'Open Extension',
                arguments: [vscode.Uri.file(ext.filePath), { selection: new vscode.Range(ext.line, 0, ext.line, 0) }]
            };
            return node;
        });
    }

    /**
     * Deduplicate objects by ID — in a mono-repo the same file can be scanned multiple times.
     */
    private deduplicateObjects(objects: { objectType: string; objectId: number; objectName: string; filePath: string }[]) {
        const seen = new Set<number>();
        return objects.filter(o => {
            if (seen.has(o.objectId)) { return false; }
            seen.add(o.objectId);
            return true;
        });
    }

    private extractProject(filePath: string): string {
        if (!filePath) { return ''; }
        const parts = filePath.split('/');
        // Look for app.json sibling hint: known AL subfolders
        const knownSubfolders = ['src', 'AL', 'Codeunits', 'Pages', 'Tables', 'Page Extensions', 'Table Extensions', 'Reports', 'Queries', 'Enums', 'XMLports'];
        for (let i = parts.length - 2; i >= 0; i--) {
            if (knownSubfolders.includes(parts[i])) {
                if (i > 0) { return parts[i - 1]; }
            }
        }
        // Fallback: use grandparent folder of the file
        if (parts.length >= 3) { return parts[parts.length - 3]; }
        return '';
    }

    private getWorkspaceTableCount(): number {
        return this.eventIndexer.getAllObjects().filter(o => o.objectType.toLowerCase() === 'table').length;
    }

    private getWorkspaceCodeunitCount(): number {
        return this.eventIndexer.getAllObjects().filter(o => o.objectType.toLowerCase() === 'codeunit').length;
    }

    private getWorkspacePageCount(): number {
        return this.eventIndexer.getAllObjects().filter(o => o.objectType.toLowerCase() === 'page').length;
    }
}

export class DependencyNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly data: DependencyNodeData
    ) {
        super(label, collapsibleState);
        this.description = description;
    }
}
