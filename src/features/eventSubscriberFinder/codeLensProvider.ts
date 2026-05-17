import * as vscode from 'vscode';
import { SubscriberMapper } from './subscriberMapper';

export class EventSubscriberCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(
        private subscriberMapper: SubscriberMapper
    ) {}

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        const eventAttrPattern = /\[(IntegrationEvent|BusinessEvent|InternalEvent)\s*\(/i;
        const procedurePattern = /(?:local\s+)?procedure\s+(\w+)/i;

        // Find the object name from this file
        const objectPattern = /^\s*(codeunit|table|tableextension|page|pageextension|report|xmlport|query)\s+(\d+)\s+"?([^"{\n]+)"?/im;
        const objectMatch = text.match(objectPattern);
        if (!objectMatch) {
            return codeLenses;
        }
        const objectName = objectMatch[3].trim();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (eventAttrPattern.test(line)) {
                // Look ahead for the procedure name
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                    const procMatch = lines[j].match(procedurePattern);
                    if (procMatch) {
                        const eventName = procMatch[1];
                        const range = new vscode.Range(j, 0, j, lines[j].length);

                        // Find subscribers for this event
                        const subscribers = this.subscriberMapper.findSubscribersForEvent(objectName, eventName);

                        if (subscribers.length > 0) {
                            // Show "N subscribers" with peek
                            const locations = subscribers.map(sub =>
                                new vscode.Location(
                                    vscode.Uri.file(sub.filePath),
                                    new vscode.Position(sub.line, 0)
                                )
                            );

                            codeLenses.push(new vscode.CodeLens(range, {
                                title: `$(eye) ${subscribers.length} subscriber${subscribers.length > 1 ? 's' : ''} in your project`,
                                command: 'editor.action.peekLocations',
                                arguments: [
                                    document.uri,
                                    new vscode.Position(j, 0),
                                    locations,
                                    'peek'
                                ]
                            }));

                            // Also show subscriber names for quick context
                            const names = subscribers.map(s => s.procedureName).join(', ');
                            codeLenses.push(new vscode.CodeLens(range, {
                                title: `→ ${names}`,
                                command: 'editor.action.peekLocations',
                                arguments: [
                                    document.uri,
                                    new vscode.Position(j, 0),
                                    locations,
                                    'peek'
                                ]
                            }));
                        } else {
                            // Show "no subscribers" with option to generate one
                            codeLenses.push(new vscode.CodeLens(range, {
                                title: `$(circle-outline) no subscribers — click to generate`,
                                command: 'alProductivityPack.generateSubscriberForEvent',
                                arguments: [objectName, eventName]
                            }));
                        }

                        break;
                    }
                }
            }
        }

        return codeLenses;
    }
}
