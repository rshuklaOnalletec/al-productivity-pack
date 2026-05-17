import * as vscode from 'vscode';
import { EventIndexer } from './eventIndexer';
import { SubscriberMapper } from './subscriberMapper';
import { ALEvent } from '../../types';

export class EventTreeProvider implements vscode.TreeDataProvider<EventTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<EventTreeItem | undefined | null | void> = new vscode.EventEmitter<EventTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<EventTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private eventIndexer: EventIndexer,
        private subscriberMapper?: SubscriberMapper
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: EventTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: EventTreeItem): Thenable<EventTreeItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        }

        if (element.contextValue === 'summary') {
            return Promise.resolve([]);
        }

        if (element.contextValue === 'objectGroup' || element.contextValue === 'objectGroupActive') {
            return Promise.resolve(this.getEventsForObject(element.objectName!));
        }

        if (element.contextValue === 'event') {
            return Promise.resolve(this.getSubscribersForEvent(element.objectName!, element.label as string));
        }

        return Promise.resolve([]);
    }

    private getRootItems(): EventTreeItem[] {
        const summary = this.getSummaryItem();
        const objects = this.getObjectGroups();
        return summary ? [summary, ...objects] : objects;
    }

    private getSummaryItem(): EventTreeItem | null {
        const allEvents = this.eventIndexer.getAllEvents();
        if (allEvents.length === 0) {
            return null;
        }

        const totalEvents = allEvents.length;
        const subscribedEvents = this.subscriberMapper
            ? allEvents.filter(e => {
                const subs = this.subscriberMapper!.findAllSubscribersForEvent(e.objectName, e.eventName);
                return subs.length > 0;
            }).length
            : 0;
        const totalSubscribers = this.eventIndexer.getWorkspaceSubscribers().length;

        const item = new EventTreeItem(
            `${totalEvents} events · ${subscribedEvents} subscribed · ${totalEvents - subscribedEvents} available`,
            `${totalSubscribers} subscriber(s) in your project`,
            vscode.TreeItemCollapsibleState.None,
            'summary'
        );
        item.tooltip = new vscode.MarkdownString(
            `**Index Summary**\n\n` +
            `- **Total Events:** ${totalEvents}\n` +
            `- **Events with subscribers:** ${subscribedEvents}\n` +
            `- **Available (unhooked):** ${totalEvents - subscribedEvents}\n` +
            `- **Your subscribers:** ${totalSubscribers}\n`
        );
        return item;
    }

    private getObjectGroups(): EventTreeItem[] {
        const events = this.eventIndexer.getAllEvents();
        const objectMap = new Map<string, { count: number; objectName: string }>();

        for (const e of events) {
            const key = `${e.objectType} ${e.objectId} - ${e.objectName}`;
            const existing = objectMap.get(key);
            if (existing) {
                existing.count++;
            } else {
                objectMap.set(key, { count: 1, objectName: e.objectName });
            }
        }

        return [...objectMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, info]) => {
            // Count how many subscribers exist for this object's events
            let subCount = 0;
            if (this.subscriberMapper) {
                const objectEvents = events.filter(e => e.objectName === info.objectName);
                for (const ev of objectEvents) {
                    subCount += this.subscriberMapper.findAllSubscribersForEvent(info.objectName, ev.eventName).length;
                }
            }

            const description = subCount > 0
                ? `${info.count} event(s) · ✓ ${subCount} subscribed`
                : `${info.count} event(s)`;

            const item = new EventTreeItem(
                label,
                description,
                vscode.TreeItemCollapsibleState.Collapsed,
                subCount > 0 ? 'objectGroupActive' : 'objectGroup'
            );
            item.objectName = info.objectName;
            return item;
        });
    }

    private getEventsForObject(objectName: string): EventTreeItem[] {
        const events = this.eventIndexer.getAllEvents();
        const objectEvents = events.filter(e => e.objectName === objectName);

        return objectEvents.map(event => {
            // Check for subscribers
            const subscribers = this.subscriberMapper
                ? this.subscriberMapper.findAllSubscribersForEvent(objectName, event.eventName)
                : [];

            const hasSubscribers = subscribers.length > 0;
            const collapsible = hasSubscribers
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

            const description = hasSubscribers
                ? `${subscribers.length} subscriber(s)`
                : `no subscribers`;

            const item = new EventTreeItem(
                event.eventName,
                description,
                collapsible,
                'event'
            );
            item.objectName = objectName;
            item.tooltip = this.getEventTooltip(event, subscribers.length);

            if (!hasSubscribers) {
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Event',
                    arguments: [
                        vscode.Uri.file(event.filePath),
                        { selection: new vscode.Range(event.line, 0, event.line, 0) }
                    ]
                };
            }

            return item;
        });
    }

    private getSubscribersForEvent(objectName: string, eventName: string): EventTreeItem[] {
        if (!this.subscriberMapper) {
            return [];
        }

        const subscribers = this.subscriberMapper.findAllSubscribersForEvent(objectName, eventName);

        return subscribers.map(sub => {
            // Extract project folder and filename from path
            const pathParts = sub.filePath.split('/');
            const fileName = pathParts[pathParts.length - 1];
            const projectFolder = this.extractProjectName(sub.filePath);
            const description = projectFolder ? `${projectFolder} · ${fileName}` : fileName;

            const item = new EventTreeItem(
                sub.procedureName,
                description,
                vscode.TreeItemCollapsibleState.None,
                'subscriber'
            );
            item.command = {
                command: 'vscode.open',
                title: 'Go to Subscriber',
                arguments: [
                    vscode.Uri.file(sub.filePath),
                    { selection: new vscode.Range(sub.line, 0, sub.line, 0) }
                ]
            };
            item.tooltip = new vscode.MarkdownString(
                `**${sub.procedureName}**\n\n` +
                `- **Project:** ${projectFolder || 'unknown'}\n` +
                `- **File:** ${fileName}\n` +
                `- **Path:** ${sub.filePath}\n` +
                `- **Line:** ${sub.line + 1}\n\n` +
                `*Click to navigate*`
            );
            return item;
        });
    }

    private extractProjectName(filePath: string): string {
        // Try to find the project folder name by looking for common BC project indicators
        const parts = filePath.split('/');

        // Look for a folder that contains src/, AL/, Codeunits/, etc. as a child
        // The project root is typically one level above these
        const knownSubfolders = ['src', 'AL', 'Codeunits', 'Pages', 'Tables', 'Page Extensions', 'Table Extensions', 'Codeunits'];

        for (let i = parts.length - 2; i >= 0; i--) {
            if (knownSubfolders.includes(parts[i])) {
                // The folder before this is likely the project name
                if (i > 0) {
                    return parts[i - 1];
                }
            }
        }

        // Fallback: if workspace folders are set, find relative path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                if (filePath.startsWith(folder.uri.fsPath)) {
                    const relative = filePath.substring(folder.uri.fsPath.length + 1);
                    const firstFolder = relative.split('/')[0];
                    return firstFolder;
                }
            }
        }

        // Last resort: return 2 levels up from filename
        if (parts.length >= 3) {
            return parts[parts.length - 3];
        }
        return '';
    }

    private getEventTooltip(event: ALEvent, subscriberCount: number): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${event.eventName}**\n\n`);
        md.appendMarkdown(`- **Type:** ${event.eventType}\n`);
        md.appendMarkdown(`- **Object:** ${event.objectType} ${event.objectId} "${event.objectName}"\n`);
        md.appendMarkdown(`- **Parameters:** \`${event.parameters || 'none'}\`\n`);
        md.appendMarkdown(`- **Subscribers:** ${subscriberCount}\n`);
        md.appendMarkdown(`- **Source:** ${event.source}\n`);
        return md;
    }
}

class EventTreeItem extends vscode.TreeItem {
    objectName?: string;

    constructor(
        public readonly label: string,
        description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
        this.description = description;

        if (contextValue === 'summary') {
            this.iconPath = new vscode.ThemeIcon('dashboard');
        } else if (contextValue === 'objectGroupActive') {
            this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (contextValue === 'objectGroup') {
            this.iconPath = new vscode.ThemeIcon('circle-large-outline');
        } else if (contextValue === 'event') {
            this.iconPath = new vscode.ThemeIcon('symbol-event');
        } else if (contextValue === 'subscriber') {
            this.iconPath = new vscode.ThemeIcon('arrow-right');
        }
    }
}
