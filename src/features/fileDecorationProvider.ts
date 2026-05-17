import * as vscode from 'vscode';
import { EventIndexer } from './eventSubscriberFinder/eventIndexer';
import { SubscriberMapper } from './eventSubscriberFinder/subscriberMapper';
import { DependencyIndexer } from './dependencyExplorer/dependencyIndexer';

export class ALFileDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    constructor(
        private eventIndexer: EventIndexer,
        private subscriberMapper: SubscriberMapper,
        private dependencyIndexer: DependencyIndexer
    ) {}

    refresh(): void {
        this._onDidChangeFileDecorations.fire(undefined);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (!uri.fsPath.endsWith('.al')) {
            return undefined;
        }

        const filePath = uri.fsPath;

        // Check if this file has published events with subscribers
        const events = this.eventIndexer.getAllEvents().filter(e => e.filePath === filePath);
        let subscribedEventCount = 0;
        for (const event of events) {
            const subs = this.subscriberMapper.findAllSubscribersForEvent(event.objectName, event.eventName);
            if (subs.length > 0) { subscribedEventCount++; }
        }

        // Check if this file defines objects that are extended or referenced
        const extensions = this.dependencyIndexer.getAllExtensions().filter(e => e.filePath === filePath);
        const fields = this.dependencyIndexer.getAllFields().filter(f => f.filePath === filePath);

        // Check if fields in this file are referenced elsewhere
        let referencedFieldCount = 0;
        for (const field of fields) {
            if (this.dependencyIndexer.getFieldReferences(field.fieldName).length > 0) {
                referencedFieldCount++;
            }
        }

        // Determine decoration
        if (subscribedEventCount > 0 && extensions.length > 0) {
            // File has both events with subscribers AND extends other objects
            return new vscode.FileDecoration(
                '⚡',
                `${subscribedEventCount} subscribed event(s), ${extensions.length} extension(s)`,
                new vscode.ThemeColor('charts.green')
            );
        }

        if (subscribedEventCount > 0) {
            return new vscode.FileDecoration(
                '⚡',
                `${subscribedEventCount} event(s) subscribed by other projects`,
                new vscode.ThemeColor('charts.green')
            );
        }

        if (extensions.length > 0) {
            return new vscode.FileDecoration(
                '↗',
                `Extends ${extensions.length} object(s)`,
                new vscode.ThemeColor('charts.blue')
            );
        }

        if (referencedFieldCount > 0) {
            return new vscode.FileDecoration(
                '◆',
                `${referencedFieldCount} field(s) referenced by other projects`,
                new vscode.ThemeColor('charts.yellow')
            );
        }

        return undefined;
    }
}
