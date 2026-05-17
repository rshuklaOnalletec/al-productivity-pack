import * as vscode from 'vscode';
import { ALEvent, ALObject, ALSubscriber } from '../../types';
import { parseALFile } from '../../utils/alParser';

export class EventIndexer {
    private events: ALEvent[] = [];
    private subscribers: ALSubscriber[] = [];
    private objects: ALObject[] = [];
    private isIndexing = false;

    async indexWorkspace(): Promise<void> {
        if (this.isIndexing) {
            return;
        }

        this.isIndexing = true;
        this.events = [];
        this.subscribers = [];
        this.objects = [];

        try {
            // Get configured search paths
            const config = vscode.workspace.getConfiguration('alProductivityPack');
            const additionalPaths = config.get<string[]>('searchPaths', []);

            // Find all .al files in workspace (YOUR code)
            const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,node_modules}/**');

            // Also search in .alpackages if configured (DEPENDENCY code)
            let packageFiles: vscode.Uri[] = [];
            if (config.get<boolean>('includeBaseApp', true)) {
                packageFiles = await vscode.workspace.findFiles('**/.alpackages/**/*.al');
            }

            // Search additional configured paths (also DEPENDENCY)
            for (const searchPath of additionalPaths) {
                const pattern = new vscode.RelativePattern(searchPath, '**/*.al');
                const files = await vscode.workspace.findFiles(pattern);
                packageFiles = packageFiles.concat(files);
            }

            const dependencyPaths = new Set(packageFiles.map(f => f.fsPath));

            const allFiles = [...alFiles, ...packageFiles];

            // Parse all files
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'AL Productivity Pack: Indexing events...',
                    cancellable: false
                },
                async (progress) => {
                    const total = allFiles.length;
                    for (let i = 0; i < allFiles.length; i++) {
                        const file = allFiles[i];
                        const source = dependencyPaths.has(file.fsPath) ? 'dependency' : 'workspace';

                        progress.report({
                            increment: (1 / total) * 100,
                            message: `${i + 1}/${total} files`
                        });

                        try {
                            const document = await vscode.workspace.openTextDocument(file);
                            const content = document.getText();
                            const result = parseALFile(content, file.fsPath);

                            // Tag each result with its source
                            this.events.push(...result.events.map(e => ({ ...e, source: source as 'workspace' | 'dependency' })));
                            this.subscribers.push(...result.subscribers.map(s => ({ ...s, source: source as 'workspace' | 'dependency' })));
                            this.objects.push(...result.objects.map(o => ({ ...o, source: source as 'workspace' | 'dependency' })));
                        } catch {
                            // Skip files that can't be read
                        }
                    }
                }
            );

            console.log(`AL Productivity Pack: Indexed ${this.events.length} events (${this.events.filter(e => e.source === 'dependency').length} from dependencies), ${this.subscribers.length} subscribers from ${allFiles.length} files`);
        } finally {
            this.isIndexing = false;
        }
    }

    getAllEvents(): ALEvent[] {
        return this.events;
    }

    getAllSubscribers(): ALSubscriber[] {
        return this.subscribers;
    }

    getAllObjects(): ALObject[] {
        return this.objects;
    }

    findEventsByObject(objectName: string): ALEvent[] {
        return this.events.filter(e =>
            e.objectName.toLowerCase().includes(objectName.toLowerCase())
        );
    }

    findEventByName(eventName: string): ALEvent | undefined {
        return this.events.find(e =>
            e.eventName.toLowerCase() === eventName.toLowerCase()
        );
    }

    searchEvents(query: string): ALEvent[] {
        const lowerQuery = query.toLowerCase();
        return this.events.filter(e =>
            e.eventName.toLowerCase().includes(lowerQuery) ||
            e.objectName.toLowerCase().includes(lowerQuery) ||
            e.parameters.toLowerCase().includes(lowerQuery)
        );
    }

    getEventCount(): number {
        return this.events.length;
    }

    getSubscriberCount(): number {
        return this.subscribers.length;
    }

    getWorkspaceSubscribers(): ALSubscriber[] {
        return this.subscribers.filter(s => s.source === 'workspace');
    }

    getDependencyEvents(): ALEvent[] {
        return this.events.filter(e => e.source === 'dependency');
    }

    getWorkspaceEvents(): ALEvent[] {
        return this.events.filter(e => e.source === 'workspace');
    }
}
