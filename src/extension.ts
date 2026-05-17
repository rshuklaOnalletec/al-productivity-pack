import * as vscode from 'vscode';
import { EventIndexer } from './features/eventSubscriberFinder/eventIndexer';
import { SubscriberMapper } from './features/eventSubscriberFinder/subscriberMapper';
import { BoilerplateGenerator } from './features/eventSubscriberFinder/boilerplateGenerator';
import { EventTreeProvider } from './features/eventSubscriberFinder/treeView';
import { EventSubscriberCodeLensProvider } from './features/eventSubscriberFinder/codeLensProvider';
import { DependencyIndexer } from './features/dependencyExplorer/dependencyIndexer';
import { DependencyTreeProvider } from './features/dependencyExplorer/dependencyTreeView';
import { AppDependencyGraph } from './features/dependencyExplorer/appDependencyGraph';

let eventIndexer: EventIndexer;
let subscriberMapper: SubscriberMapper;
let dependencyIndexer: DependencyIndexer;

export function activate(context: vscode.ExtensionContext) {
    console.log('AL Productivity Pack is now active');

    eventIndexer = new EventIndexer();
    subscriberMapper = new SubscriberMapper(eventIndexer);
    dependencyIndexer = new DependencyIndexer();
    const boilerplateGenerator = new BoilerplateGenerator();
    const treeProvider = new EventTreeProvider(eventIndexer, subscriberMapper);
    const codeLensProvider = new EventSubscriberCodeLensProvider(subscriberMapper);
    const dependencyTreeProvider = new DependencyTreeProvider(dependencyIndexer, eventIndexer, subscriberMapper);

    // Register tree views
    vscode.window.registerTreeDataProvider('alEventExplorer', treeProvider);
    vscode.window.registerTreeDataProvider('alDependencyExplorer', dependencyTreeProvider);

    // Register CodeLens — shows subscriber info directly on event publishers
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'al', scheme: 'file' },
            codeLensProvider
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('alProductivityPack.findEvents', async () => {
            const events = eventIndexer.getAllEvents();
            if (events.length === 0) {
                await eventIndexer.indexWorkspace();
            }

            const items = eventIndexer.getAllEvents().map(event => ({
                label: `$(symbol-event) ${event.eventName}`,
                description: `${event.objectType} ${event.objectId} - ${event.objectName}`,
                detail: `Parameters: ${event.parameters}`,
                event
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Search for published events...',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.event.filePath);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(selected.event.line, 0);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                editor.selection = new vscode.Selection(position, position);
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.findSubscribers', async () => {
            const subscribers = subscriberMapper.getAllSubscribers();
            if (subscribers.length === 0) {
                await eventIndexer.indexWorkspace();
            }

            const items = subscriberMapper.getAllSubscribers().map(sub => ({
                label: `$(symbol-method) ${sub.procedureName}`,
                description: `→ ${sub.targetObjectType} ${sub.targetObjectName}::${sub.targetEventName}`,
                detail: sub.filePath,
                subscriber: sub
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Search for event subscribers...',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.subscriber.filePath);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(selected.subscriber.line, 0);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                editor.selection = new vscode.Selection(position, position);
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.generateSubscriber', async () => {
            const events = eventIndexer.getAllEvents();
            if (events.length === 0) {
                await eventIndexer.indexWorkspace();
            }

            const items = eventIndexer.getAllEvents().map(event => ({
                label: event.eventName,
                description: `${event.objectType} ${event.objectId} - ${event.objectName}`,
                detail: `Parameters: ${event.parameters}`,
                event
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an event to subscribe to...',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                const snippet = boilerplateGenerator.generate(selected.event);
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    editor.insertSnippet(new vscode.SnippetString(snippet));
                }
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.showEventChain', async () => {
            const events = eventIndexer.getAllEvents();
            const objectNames = [...new Set(events.map(e => e.objectName))];

            const selected = await vscode.window.showQuickPick(objectNames, {
                placeHolder: 'Select an object to view its event chain...'
            });

            if (selected) {
                const objectEvents = events
                    .filter(e => e.objectName === selected)
                    .sort((a, b) => a.line - b.line);

                // Enrich events with subscriber info
                const enrichedEvents = objectEvents.map(event => {
                    const subs = subscriberMapper.findAllSubscribersForEvent(selected, event.eventName);
                    const mySubCount = subs.filter(s => s.source === 'workspace').length;
                    return { ...event, subscriberCount: mySubCount, subscribers: subs };
                });

                const panel = vscode.window.createWebviewPanel(
                    'eventChain',
                    `Event Chain: ${selected}`,
                    vscode.ViewColumn.Beside,
                    { enableScripts: true }
                );

                panel.webview.html = getEventChainHtml(selected, enrichedEvents);

                // Handle clicks on subscriber names — navigate to file
                panel.webview.onDidReceiveMessage(async (message) => {
                    if (message.command === 'openSubscriber') {
                        const { filePath, line } = message;
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
                        const position = new vscode.Position(line, 0);
                        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                        editor.selection = new vscode.Selection(position, position);
                    }
                });
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.detectDeadSubscribers', async () => {
            const deadSubscribers = subscriberMapper.findDeadSubscribers();

            if (deadSubscribers.length === 0) {
                vscode.window.showInformationMessage('No dead subscribers found. All subscriptions are valid.');
                return;
            }

            const items = deadSubscribers.map(sub => ({
                label: `$(warning) ${sub.procedureName}`,
                description: `→ ${sub.targetObjectType} ${sub.targetObjectName}::${sub.targetEventName}`,
                detail: `${sub.filePath}:${sub.line + 1} — Target event not found`,
                subscriber: sub
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Found ${deadSubscribers.length} dead subscriber(s). Select to navigate...`,
                matchOnDescription: true
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.subscriber.filePath);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(selected.subscriber.line, 0);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                editor.selection = new vscode.Selection(position, position);
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.fileInsights', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'al') { return; }

            const filePath = editor.document.uri.fsPath;
            const fileName = filePath.split('/').pop() || '';

            // Gather insights for this file
            const events = eventIndexer.getAllEvents().filter(e => e.filePath === filePath);
            const subscribers = eventIndexer.getAllSubscribers().filter(s => s.filePath === filePath);
            const extensions = dependencyIndexer.getAllExtensions().filter(e => e.filePath === filePath);
            const fields = dependencyIndexer.getAllFields().filter(f => f.filePath === filePath);
            const objects = eventIndexer.getAllObjects().filter(o => o.filePath === filePath);

            // Build menu items
            type InsightItem = vscode.QuickPickItem & { action?: () => void };
            const items: InsightItem[] = [];

            // Header
            const objectLabel = objects.length > 0 ? `${objects[0].objectType} ${objects[0].objectId} "${objects[0].objectName}"` : fileName;
            items.push({ label: objectLabel, kind: vscode.QuickPickItemKind.Separator });

            // Events published by this file
            if (events.length > 0) {
                items.push({ label: `$(symbol-event) Events Published`, kind: vscode.QuickPickItemKind.Separator });
                for (const event of events) {
                    const subs = subscriberMapper.findAllSubscribersForEvent(event.objectName, event.eventName);
                    items.push({
                        label: `    ${event.eventName}`,
                        description: subs.length > 0 ? `${subs.length} subscriber(s)` : 'no subscribers',
                        detail: event.parameters ? `(${event.parameters})` : undefined,
                        action: () => {
                            const pos = new vscode.Position(event.line, 0);
                            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                            editor.selection = new vscode.Selection(pos, pos);
                        }
                    });
                }
            }

            // Subscribers in this file
            if (subscribers.length > 0) {
                items.push({ label: `$(plug) Event Subscribers`, kind: vscode.QuickPickItemKind.Separator });
                for (const sub of subscribers) {
                    items.push({
                        label: `    ${sub.procedureName}`,
                        description: `→ ${sub.targetObjectName}::${sub.targetEventName}`,
                        action: () => {
                            const pos = new vscode.Position(sub.line, 0);
                            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                            editor.selection = new vscode.Selection(pos, pos);
                        }
                    });
                }
            }

            // Extensions declared in this file
            if (extensions.length > 0) {
                items.push({ label: `$(git-merge) Extensions`, kind: vscode.QuickPickItemKind.Separator });
                for (const ext of extensions) {
                    items.push({
                        label: `    ${ext.extensionType} "${ext.extensionName}"`,
                        description: `extends "${ext.targetObject}"`,
                        action: () => {
                            const pos = new vscode.Position(ext.line, 0);
                            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                            editor.selection = new vscode.Selection(pos, pos);
                        }
                    });
                }
            }

            // Fields with cross-references
            const referencedFields = fields.filter(f =>
                dependencyIndexer.getFieldReferences(f.fieldName).length > 0
            );
            if (referencedFields.length > 0) {
                items.push({ label: `$(symbol-field) Fields Referenced Externally`, kind: vscode.QuickPickItemKind.Separator });
                for (const field of referencedFields) {
                    const refs = dependencyIndexer.getFieldReferences(field.fieldName);
                    items.push({
                        label: `    "${field.fieldName}"`,
                        description: `${field.dataType} · ${refs.length} reference(s)`,
                        action: () => {
                            const pos = new vscode.Position(field.line, 0);
                            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                            editor.selection = new vscode.Selection(pos, pos);
                        }
                    });
                }
            }

            // Objects in this file that are extended by others
            for (const obj of objects) {
                const objExtensions = dependencyIndexer.getExtensionsForObject(obj.objectName);
                if (objExtensions.length > 0) {
                    items.push({ label: `$(references) Extended By Other Projects`, kind: vscode.QuickPickItemKind.Separator });
                    for (const ext of objExtensions) {
                        const project = ext.filePath.split('/').slice(-3, -1).join('/');
                        items.push({
                            label: `    ${ext.extensionName}`,
                            description: project,
                            action: async () => {
                                const doc = await vscode.workspace.openTextDocument(ext.filePath);
                                const ed = await vscode.window.showTextDocument(doc);
                                const pos = new vscode.Position(ext.line, 0);
                                ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                                ed.selection = new vscode.Selection(pos, pos);
                            }
                        });
                    }
                    break; // Only show once
                }
            }

            // Table references to objects in this file
            for (const obj of objects) {
                const tableRefs = dependencyIndexer.getTableReferences(obj.objectName);
                if (tableRefs.length > 0) {
                    items.push({ label: `$(database) Referenced As Record`, kind: vscode.QuickPickItemKind.Separator });
                    const projects = [...new Set(tableRefs.map(r => r.projectName))].filter(p => p);
                    items.push({
                        label: `    Used in ${tableRefs.length} place(s)`,
                        description: projects.join(', ')
                    });
                    break;
                }
            }

            if (items.length <= 1) {
                vscode.window.showInformationMessage(`No insights found for ${fileName}. Try refreshing the index.`);
                return;
            }

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `File Insights: ${fileName}`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected && (selected as InsightItem).action) {
                (selected as InsightItem).action!();
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.showAppDependencyGraph', async () => {
            const graph = new AppDependencyGraph();
            const result = await graph.buildGraph();

            if (!result) { return; }

            const panel = vscode.window.createWebviewPanel(
                'appDependencyGraph',
                'Deploy Sequence',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            panel.webview.html = graph.generateHtml(result.apps, result.edges, result.layers);

            panel.webview.onDidReceiveMessage(async (message) => {
                if (message.command === 'openApp') {
                    const appJsonPath = vscode.Uri.file(message.folder + '/app.json');
                    try {
                        const doc = await vscode.workspace.openTextDocument(appJsonPath);
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    } catch {
                        // If app.json doesn't exist, just open the folder
                        const folderUri = vscode.Uri.file(message.folder);
                        await vscode.commands.executeCommand('revealInExplorer', folderUri);
                    }
                }
            });
        }),

        vscode.commands.registerCommand('alProductivityPack.refreshIndex', async () => {
            await eventIndexer.indexWorkspace();
            await dependencyIndexer.indexWorkspace();
            treeProvider.refresh();
            codeLensProvider.refresh();
            dependencyTreeProvider.refresh();
            vscode.window.showInformationMessage('AL index refreshed (events + dependencies).');
        }),

        vscode.commands.registerCommand('alProductivityPack.peekSubscribersAtCursor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const document = editor.document;
            const position = editor.selection.active;
            const line = document.lineAt(position.line).text;

            // Try to detect event name: look for procedure name on current or nearby lines
            const procMatch = line.match(/procedure\s+(\w+)/i);
            let eventName = '';
            let objectName = '';

            if (procMatch) {
                eventName = procMatch[1];
                // Find the object this event belongs to
                for (let i = position.line; i >= 0; i--) {
                    const objMatch = document.lineAt(i).text.match(/^\s*(codeunit|table|page|report)\s+\d+\s+"?([^"{\n]+)"?/i);
                    if (objMatch) { objectName = objMatch[2].trim(); break; }
                }
            } else {
                // Try to get word under cursor as event name
                const wordRange = document.getWordRangeAtPosition(position);
                if (wordRange) {
                    eventName = document.getText(wordRange);
                    for (let i = position.line; i >= 0; i--) {
                        const objMatch = document.lineAt(i).text.match(/^\s*(codeunit|table|page|report)\s+\d+\s+"?([^"{\n]+)"?/i);
                        if (objMatch) { objectName = objMatch[2].trim(); break; }
                    }
                }
            }

            if (!eventName) {
                vscode.window.showInformationMessage('Place cursor on an event procedure name.');
                return;
            }

            const subscribers = subscriberMapper.findAllSubscribersForEvent(objectName, eventName);
            if (subscribers.length === 0) {
                vscode.window.showInformationMessage(`No subscribers found for "${eventName}" in "${objectName}".`);
                return;
            }

            const items = subscribers.map(sub => ({
                label: `$(symbol-method) ${sub.procedureName}`,
                description: `${sub.source === 'workspace' ? '📁' : '📦'} ${sub.filePath.split('/').slice(-3, -1).join('/')}`,
                detail: sub.filePath.split('/').pop(),
                subscriber: sub
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${subscribers.length} subscriber(s) for ${objectName}::${eventName}`,
                matchOnDescription: true
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.subscriber.filePath);
                const ed = await vscode.window.showTextDocument(doc);
                const pos = new vscode.Position(selected.subscriber.line, 0);
                ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                ed.selection = new vscode.Selection(pos, pos);
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.peekDependenciesAtCursor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const document = editor.document;
            const position = editor.selection.active;

            // Detect what's under cursor: quoted "Name With Spaces" or unquoted SingleWord
            let symbolName = '';
            const quotedRange = document.getWordRangeAtPosition(position, /"[^"]+"/);
            if (quotedRange) {
                symbolName = document.getText(quotedRange).replace(/"/g, '').trim();
            } else {
                const wordRange = document.getWordRangeAtPosition(position);
                if (wordRange) {
                    symbolName = document.getText(wordRange);
                }
            }

            // Skip AL keywords
            const alKeywords = ['table', 'tableextension', 'page', 'pageextension', 'codeunit', 'report', 'field', 'procedure', 'local', 'internal', 'var', 'begin', 'end', 'if', 'then', 'else', 'true', 'false', 'extends', 'implements'];
            if (!symbolName || alKeywords.includes(symbolName.toLowerCase())) {
                // Try to extract object name from the line (e.g. "table 50100 QtyAvailToSellTigOAC")
                const line = document.lineAt(position.line).text;
                const objMatch = line.match(/^\s*(?:table|tableextension|page|pageextension|codeunit|report|enum|enumextension)\s+\d+\s+"?([^"{\n]+)"?/i);
                if (objMatch) {
                    symbolName = objMatch[1].trim();
                } else {
                    vscode.window.showInformationMessage('Place cursor on a field, table, or object name.');
                    return;
                }
            }

            // Gather all cross-references for this symbol
            type RefItem = { label: string; description: string; detail?: string; filePath: string; line: number };
            const results: RefItem[] = [];

            // Check table references
            const tableRefs = dependencyIndexer.getTableReferences(symbolName);
            for (const ref of tableRefs) {
                results.push({
                    label: `$(database) Record "${symbolName}"`,
                    description: ref.projectName || ref.filePath.split('/').slice(-3, -1).join('/'),
                    detail: ref.context,
                    filePath: ref.filePath,
                    line: ref.line
                });
            }

            // Check field references
            const fieldRefs = dependencyIndexer.getFieldReferences(symbolName);
            for (const ref of fieldRefs) {
                results.push({
                    label: `$(symbol-field) "${symbolName}"`,
                    description: ref.projectName || ref.filePath.split('/').slice(-3, -1).join('/'),
                    detail: ref.context,
                    filePath: ref.filePath,
                    line: ref.line
                });
            }

            // Check object references (codeunit, page, etc.)
            const objRefs = dependencyIndexer.getObjectReferences(symbolName);
            for (const ref of objRefs) {
                results.push({
                    label: `$(symbol-class) ${ref.referenceType}::${symbolName}`,
                    description: ref.projectName || ref.filePath.split('/').slice(-3, -1).join('/'),
                    detail: ref.context,
                    filePath: ref.filePath,
                    line: ref.line
                });
            }

            // Check extensions
            const extensions = dependencyIndexer.getExtensionsForObject(symbolName);
            for (const ext of extensions) {
                results.push({
                    label: `$(git-merge) ${ext.extensionType} "${ext.extensionName}"`,
                    description: ext.filePath.split('/').slice(-3, -1).join('/'),
                    detail: `extends "${ext.targetObject}"`,
                    filePath: ext.filePath,
                    line: ext.line
                });
            }

            // Also check subscribers for this symbol (if it's an event)
            const allEvents = eventIndexer.getAllEvents().filter(e => e.eventName === symbolName);
            for (const event of allEvents) {
                const subs = subscriberMapper.findAllSubscribersForEvent(event.objectName, event.eventName);
                for (const sub of subs) {
                    results.push({
                        label: `$(symbol-event) subscriber: ${sub.procedureName}`,
                        description: sub.filePath.split('/').slice(-3, -1).join('/'),
                        detail: `→ ${event.objectName}::${event.eventName}`,
                        filePath: sub.filePath,
                        line: sub.line
                    });
                }
            }

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No cross-references found for "${symbolName}".`);
                return;
            }

            const selected = await vscode.window.showQuickPick(results, {
                placeHolder: `${results.length} reference(s) for "${symbolName}"`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.filePath);
                const ed = await vscode.window.showTextDocument(doc);
                const pos = new vscode.Position(selected.line, 0);
                ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                ed.selection = new vscode.Selection(pos, pos);
            }
        }),

        vscode.commands.registerCommand('alProductivityPack.generateSubscriberForEvent', async (objectName: string, eventName: string) => {
            // Find the event details
            const event = eventIndexer.getAllEvents().find(e =>
                e.objectName === objectName && e.eventName === eventName
            );

            if (!event) {
                vscode.window.showErrorMessage(`Event ${eventName} not found in ${objectName}`);
                return;
            }

            const snippet = boilerplateGenerator.generate(event);

            // Ask where to insert — open a workspace .al file
            const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,node_modules}/**');
            const fileItems = alFiles.map(f => ({
                label: vscode.workspace.asRelativePath(f),
                uri: f
            }));

            const targetFile = await vscode.window.showQuickPick(fileItems, {
                placeHolder: 'Select a file in your project to insert the subscriber...'
            });

            if (targetFile) {
                const doc = await vscode.workspace.openTextDocument(targetFile.uri);
                const editor = await vscode.window.showTextDocument(doc);
                // Insert at the end (before last closing brace)
                const text = doc.getText();
                const lastBrace = text.lastIndexOf('}');
                if (lastBrace > -1) {
                    const position = doc.positionAt(lastBrace);
                    const insertPos = new vscode.Position(position.line, 0);
                    editor.selection = new vscode.Selection(insertPos, insertPos);
                    await editor.insertSnippet(new vscode.SnippetString('\n' + snippet + '\n\n'));
                }
            }
        })
    );

    // Auto-index on activation
    const config = vscode.workspace.getConfiguration('alProductivityPack');
    if (config.get<boolean>('autoRefresh', true)) {
        eventIndexer.indexWorkspace().then(() => {
            treeProvider.refresh();
            codeLensProvider.refresh();
        });
        dependencyIndexer.indexWorkspace().then(() => {
            dependencyTreeProvider.refresh();
        });

        // Watch for file changes
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.al');
        watcher.onDidChange(() => {
            eventIndexer.indexWorkspace().then(() => { treeProvider.refresh(); codeLensProvider.refresh(); });
            dependencyIndexer.indexWorkspace().then(() => { dependencyTreeProvider.refresh(); });
        });
        watcher.onDidCreate(() => {
            eventIndexer.indexWorkspace().then(() => { treeProvider.refresh(); codeLensProvider.refresh(); });
            dependencyIndexer.indexWorkspace().then(() => { dependencyTreeProvider.refresh(); });
        });
        watcher.onDidDelete(() => {
            eventIndexer.indexWorkspace().then(() => { treeProvider.refresh(); codeLensProvider.refresh(); });
            dependencyIndexer.indexWorkspace().then(() => { dependencyTreeProvider.refresh(); });
        });
        context.subscriptions.push(watcher);
    }
}

function getEventChainHtml(objectName: string, events: { eventName: string; line: number; eventType: string; parameters: string; source: string; subscriberCount: number; subscribers: { procedureName: string; filePath: string; source: string; line: number }[] }[]): string {
    const totalSubscribers = events.reduce((sum, e) => sum + e.subscriberCount, 0);
    const unhooked = events.filter(e => e.subscriberCount === 0).length;
    const eventSource = events.length > 0 ? events[0].source : 'workspace';
    const sourceLabel = eventSource === 'dependency' ? '📦 Dependency (Parent)' : '📁 Your Project';

    const eventRows = events.map((e, i) => {
        const phase = detectPhase(e.eventName);
        const mySubscribers = e.subscribers.filter(s => s.source === 'workspace');
        const depSubscribers = e.subscribers.filter(s => s.source === 'dependency');

        const statusClass = mySubscribers.length > 0 ? 'has-subscribers' : 'no-subscribers';

        let subscriberBadge = '';
        if (mySubscribers.length > 0) {
            subscriberBadge = `<span class="badge active">✓ your project subscribes (${mySubscribers.length})</span>`;
        } else {
            subscriberBadge = `<span class="badge empty">available — not subscribed</span>`;
        }

        let subscriberList = '';
        if (mySubscribers.length > 0) {
            subscriberList = `<div class="subscriber-list"><div class="subscriber-section-label">Your subscribers:</div>${mySubscribers.map(s =>
                `<a class="subscriber-link workspace-sub" href="#" data-file="${escapeHtml(s.filePath)}" data-line="${s.line}">→ ${s.procedureName}</a>`
            ).join('')}</div>`;
        }
        if (depSubscribers.length > 0) {
            subscriberList += `<div class="subscriber-list"><div class="subscriber-section-label">From other extensions:</div>${depSubscribers.map(s =>
                `<a class="subscriber-link dep-sub" href="#" data-file="${escapeHtml(s.filePath)}" data-line="${s.line}">→ ${s.procedureName}</a>`
            ).join('')}</div>`;
        }

        const params = e.parameters
            ? `<div class="params"><code>${escapeHtml(e.parameters)}</code></div>`
            : `<div class="params"><code>— no parameters —</code></div>`;

        return `
        <div class="event-node ${statusClass}">
            <div class="event-left">
                <div class="event-number">${i + 1}</div>
                <div class="phase-badge phase-${phase}">${phase}</div>
            </div>
            <div class="event-info">
                <div class="event-header">
                    <span class="event-name">${e.eventName}</span>
                    ${subscriberBadge}
                </div>
                <span class="event-type">${e.eventType} · Line ${e.line + 1}</span>
                ${params}
                ${subscriberList}
            </div>
        </div>
        ${i < events.length - 1 ? '<div class="connector">│</div>' : ''}
    `;
    }).join('');

    return `<!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); max-width: 700px; }
            h2 { color: var(--vscode-textLink-foreground); margin-bottom: 4px; }
            .summary { opacity: 0.8; margin-bottom: 20px; font-size: 13px; }
            .summary strong { color: var(--vscode-textLink-foreground); }
            .event-node { display: flex; align-items: flex-start; padding: 12px 16px; margin: 4px 0; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; transition: border-color 0.2s; }
            .event-node.has-subscribers { border-left: 3px solid var(--vscode-charts-green); }
            .event-node.no-subscribers { border-left: 3px solid var(--vscode-panel-border); opacity: 0.75; }
            .event-left { display: flex; flex-direction: column; align-items: center; margin-right: 14px; min-width: 50px; }
            .event-number { width: 26px; height: 26px; border-radius: 50%; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; }
            .event-info { display: flex; flex-direction: column; flex: 1; }
            .event-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .event-name { font-weight: bold; font-size: 14px; }
            .event-type { font-size: 11px; opacity: 0.6; margin-top: 2px; }
            .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; }
            .badge.active { background: var(--vscode-charts-green); color: #fff; }
            .badge.empty { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); opacity: 0.5; }
            .phase-badge { font-size: 9px; padding: 2px 6px; border-radius: 3px; margin-top: 6px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; }
            .phase-before { background: #f59e0b33; color: #f59e0b; }
            .phase-after { background: #10b98133; color: #10b981; }
            .phase-on { background: #6366f133; color: #6366f1; }
            .phase-validate { background: #ef444433; color: #ef4444; }
            .phase-other { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
            .params { margin-top: 6px; padding: 4px 8px; background: var(--vscode-textBlockQuote-background); border-radius: 3px; font-size: 11px; overflow-x: auto; }
            .params code { white-space: pre-wrap; word-break: break-all; }
            .subscriber-list { margin-top: 6px; padding-left: 4px; }
            .subscriber-link { display: block; font-size: 11px; padding: 2px 4px; text-decoration: none; cursor: pointer; border-radius: 3px; }
            .subscriber-link:hover { background: var(--vscode-list-hoverBackground); text-decoration: underline; }
            .workspace-sub { color: var(--vscode-charts-green); }
            .dep-sub { color: var(--vscode-charts-yellow); opacity: 0.7; }
            .subscriber-section-label { font-size: 10px; opacity: 0.6; margin-top: 4px; text-transform: uppercase; }
            .connector { text-align: center; color: var(--vscode-panel-border); font-size: 14px; line-height: 1; padding: 2px 0; margin-left: 38px; }
            .legend { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); font-size: 12px; opacity: 0.7; }
            .legend span { margin-right: 16px; }
            .source-banner { padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; font-size: 12px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); }
        </style>
    </head>
    <body>
        <h2>Event Chain: ${objectName}</h2>
        <div class="source-banner">
            Source: <strong>${sourceLabel}</strong><br/>
            These events are published by this object. Your project can subscribe to them.
        </div>
        <div class="summary">
            <strong>${events.length}</strong> events published · 
            <strong>${totalSubscribers}</strong> subscribed by your project · 
            <strong>${unhooked}</strong> available (not yet subscribed)
        </div>
        ${eventRows}
        <div class="legend">
            <span>🟢 = your project subscribes</span>
            <span>⚪ = available for you to hook into</span>
            <span>🟡 = other extensions subscribe</span>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            document.querySelectorAll('.subscriber-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const filePath = link.getAttribute('data-file');
                    const line = parseInt(link.getAttribute('data-line') || '0', 10);
                    vscode.postMessage({ command: 'openSubscriber', filePath, line });
                });
            });
        </script>
    </body>
    </html>`;
}

function detectPhase(eventName: string): string {
    const lower = eventName.toLowerCase();
    if (lower.includes('onbefore') || lower.includes('pre')) { return 'before'; }
    if (lower.includes('onafter') || lower.includes('post') || lower.includes('finalize')) { return 'after'; }
    if (lower.includes('validate') || lower.includes('check')) { return 'validate'; }
    if (lower.includes('onrun') || lower.includes('init') || lower.includes('oninit')) { return 'on'; }
    return 'other';
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function deactivate() {
    // Cleanup
}
