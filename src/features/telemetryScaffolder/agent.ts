import * as vscode from 'vscode';

// Decoration type for highlighting proposed telemetry lines
const addedLineDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
});

interface ALProcedureBlock {
    name: string;
    line: number;
    endLine: number;
    type: 'procedure' | 'trigger';
    code: string;
}

interface ALFileInfo {
    uri: vscode.Uri;
    objectName: string;
    objectType: string;
    procedures: ALProcedureBlock[];
}

interface GeneratedTelemetry {
    procedureName: string;
    code: string;
    varDeclarations: string[];
}

interface TelemetryResult {
    generated: GeneratedTelemetry | null;
    skipReason?: string;
}

interface TelemetryProposal {
    file: ALFileInfo;
    procedure: ALProcedureBlock;
    telemetry: GeneratedTelemetry;
    tag: string;
}

const SYSTEM_PROMPT = `You are an expert Business Central AL developer and telemetry architect.
Your job is to deeply analyze AL code, understand its SPECIFIC business purpose, and instrument it with precise telemetry following Microsoft's official guidance.

CRITICAL — EVENT NAMES MUST BE SPECIFIC TO THE CODE:
- READ the procedure code carefully. Understand EXACTLY what it does.
- The EventName MUST describe the specific action: "Item unit of measure created", "Job approval status set to pending", "Customer payment terms validated"
- NEVER use generic descriptions like "Records processed", "Operation completed", "Data updated"
- Look at the table being modified, the fields being set, the business action happening
- Examples of GOOD event names: "Sales invoice posted", "Item UOM inserted", "Workflow approval requested", "Bank account reconciled"
- Examples of BAD event names: "Records processed", "Data saved", "Operation done", "Records updated"

CRITICAL — AL ERROR HANDLING (NOT C#):
- AL does NOT have try/catch/finally. NEVER generate try/catch blocks.
- AL uses [TryFunction] attribute on procedures (returns Boolean implicitly)
- Error handling pattern: "if not MyTryProc() then" or "if not Codeunit.Run(...) then"
- After a failed try-function: GetLastErrorText() and GetLastErrorCallStack() are available
- NEVER wrap existing code in try/catch. NEVER add try/catch. It does not exist in AL.
- Only add telemetry to EXISTING error handling paths (if not ... then blocks that already exist)

MICROSOFT'S RECOMMENDED APPROACH — FeatureTelemetry codeunit (from System Application):
Microsoft recommends using FeatureTelemetry over raw Session.LogMessage. It provides structured telemetry:

1. FeatureTelemetry.LogUsage('TAG', 'FeatureName', 'EventName past tense', CustomDimensions);
   - Call when a feature is SUCCESSFULLY used
   - Event names MUST be specific and use PAST TENSE describing what the code actually did
   - ALWAYS include CustomDimensions with relevant context
   
2. FeatureTelemetry.LogError('TAG', 'FeatureName', 'EventName present tense', GetLastErrorText(), GetLastErrorCallStack(), CustomDimensions);
   - Call ONLY in existing error paths (after "if not TryFunction() then" or "if not Codeunit.Run() then")
   - Event names use PRESENT TENSE: "Sending email", "Posting invoice", "Creating job"
   - NEVER create new error handling blocks to add telemetry. Only instrument EXISTING ones.
   - ALWAYS include CustomDimensions with relevant context
   
3. FeatureTelemetry.LogUptake('TAG', 'FeatureName', Enum::"Feature Uptake Status"::Used);
   - Track feature adoption: Discovered -> Set up -> Used

CUSTOM DIMENSIONS — ALWAYS INCLUDE:
- Declare: CustomDimensions: Dictionary of [Text, Text];
- Add relevant context BEFORE the LogUsage/LogError call:
  CustomDimensions.Add('RecordId', Format(Rec.RecordId));
  CustomDimensions.Add('TableName', Format(Rec.TableCaption));
  CustomDimensions.Add('Count', Format(Counter));
  CustomDimensions.Add('DocumentNo', SalesHeader."No.");
- Use Format() for non-Text values (Integer, RecordId, DateTime, etc.)
- Include 1-3 meaningful dimensions per call (record ID, count, key identifiers)
- Pass as last parameter: FeatureTelemetry.LogUsage('TAG', 'Feature', 'Event', CustomDimensions);

Feature names: short, identifiable ("Retention Policies", "Job Creation", "BSO Integration")

WHAT YOU MUST NEVER DO:
- NEVER add try/catch (does not exist in AL)
- NEVER wrap code in begin/end blocks that weren't there before to create error handling
- NEVER add [TryFunction] to an existing procedure
- NEVER change the procedure's signature or return type
- NEVER restructure existing code logic
- ONLY ADD telemetry lines. Do not modify or move existing lines.

WHEN TO USE WHICH:
- FeatureTelemetry.LogUsage -> After successful operations that already exist in the code
- FeatureTelemetry.LogError -> ONLY in existing "if not ... then" error paths
- FeatureTelemetry.LogUptake -> On page triggers (OnOpenPage), after setup writes
- Session.LogMessage -> ONLY for performance timing with custom dimensions

STEP 1 - CLASSIFY the code:
- POSTING: Creates/modifies records -> LogUsage after the Insert/Modify/Post call
- VALIDATION: Checks rules -> LogError only if there's an existing Error() call or exit path
- INTEGRATION: External API calls -> LogUsage after success, LogError in existing failure path
- BATCH: Loop processing -> LogUsage after the loop with count
- LOOKUP: Reads data -> NO telemetry (too noisy)
- ERROR_HANDLING: Existing "if not TryFunc() then" -> LogError there
- STATE_CHANGE: Status changes -> LogUsage after the state change
- CALCULATION: Computations -> NO telemetry unless business-critical

STEP 2 - DECIDE PLACEMENT:
- After Insert/Modify/Delete calls -> FeatureTelemetry.LogUsage
- Inside existing "if not ... then" blocks -> FeatureTelemetry.LogError
- After loops complete -> FeatureTelemetry.LogUsage with count
- Simple getters/setters -> "// No telemetry needed: simple accessor"

CRITICAL AL SYNTAX RULES:
- FeatureTelemetry.LogUsage signature (preferred with CustomDimensions):
  LogUsage(EventId: Text; FeatureName: Text; EventName: Text; CustomDimensions: Dictionary of [Text, Text])
- FeatureTelemetry.LogError signature (preferred with CustomDimensions):
  LogError(EventId: Text; FeatureName: Text; EventName: Text; ErrorText: Text; ErrorCallStack: Text; CustomDimensions: Dictionary of [Text, Text])
- Session.LogMessage needs 6+ args (Dictionary or key-value pairs as 6th+ arg)
- CustomDimensions.Add(Key: Text, Value: Text) — second param MUST be Text, use Format() for non-text
- Variable declarations go in //VAR: lines. Example: //VAR: FeatureTelemetry: Codeunit "Feature Telemetry";
- Integer to Text: Format(MyInteger). NO .ToString()
- RecordId to Text: Format(Rec.RecordId). NO .AsText
- Duration: StartTime := CurrentDateTime; then Format(CurrentDateTime - StartTime)
- Dictionary.Add() second param must be Text. Use Format() for non-text.
- NEVER output backticks, markdown fences, or explanatory prose.

OUTPUT FORMAT — READ THIS CAREFULLY:
- If no telemetry is appropriate, output ONLY: // No telemetry needed: [brief reason]
- Otherwise, output ONLY the telemetry lines to ADD. Typically 1-4 lines total.
- DO NOT output the original procedure code. DO NOT repeat any existing lines.
- DO NOT add counting variables, loops, or restructure anything.
- DO NOT add nested begin/end blocks or var blocks inside begin.
- A typical output looks like this (3-4 lines):

//VAR: FeatureTelemetry: Codeunit "Feature Telemetry";
//VAR: CustomDimensions: Dictionary of [Text, Text];
CustomDimensions.Add('RecordId', Format(Rec.RecordId));
FeatureTelemetry.LogUsage('TAG-0001', 'My Feature', 'Records created', CustomDimensions);

- //VAR: lines declare variables to add to the existing var section (NOT inline)
- Non-//VAR: lines are inserted BEFORE "end;" by default (i.e., AFTER the operation completes)
- If code must go at the TOP of the body (e.g., StartTime := CurrentDateTime for timing), prefix with //BEGIN: on a separate line
- LogUsage goes AFTER the operation — this is the default placement (before end;)
- NEVER output the original procedure code
- NEVER add new begin/end pairs
- NEVER add counter variables or restructure logic
- Just output the FeatureTelemetry call(s) and nothing else`;

/**
 * AI-powered telemetry agent that analyzes AL code,
 * auto-detects feature names from object names, and shows a preview before applying.
 */
export async function addTelemetryAgentCommand(): Promise<void> {
    // Check for Copilot LM availability
    const model = await selectModel();
    if (!model) { return; }

    // Ask: active file or entire project?
    const scope = await vscode.window.showQuickPick(
        [
            { label: '$(file) Active File', description: 'Analyze the current AL file only', value: 'file' as const },
            { label: '$(folder) Entire Project', description: 'Scan all .al files in the workspace', value: 'project' as const },
        ],
        { title: 'ALP: Add Telemetry (AI)', placeHolder: 'Scope: analyze active file or entire project?' },
    );
    if (!scope) { return; }

    let alFiles: vscode.Uri[];
    if (scope.value === 'file') {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'al') {
            vscode.window.showWarningMessage('Open an AL file to add telemetry.');
            return;
        }
        alFiles = [editor.document.uri];
    } else {
        alFiles = await vscode.workspace.findFiles('**/*.al', '**/node_modules/**');
        if (alFiles.length === 0) {
            vscode.window.showWarningMessage('No .al files found in the workspace.');
            return;
        }
    }

    // Analyze files and collect proposals
    const proposals: TelemetryProposal[] = [];
    const skippedReasons: string[] = [];
    let tagCounter = 1;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'ALP: Scanning project for telemetry',
        cancellable: true,
    }, async (progress, token) => {
        for (let i = 0; i < alFiles.length; i++) {
            if (token.isCancellationRequested) { break; }

            const uri = alFiles[i];
            const fileName = vscode.workspace.asRelativePath(uri);
            progress.report({ message: fileName, increment: 100 / alFiles.length });

            const document = await vscode.workspace.openTextDocument(uri);
            const fileInfo = parseALFile(document);
            if (!fileInfo || fileInfo.procedures.length === 0) { continue; }

            for (const proc of fileInfo.procedures) {
                if (token.isCancellationRequested) { break; }

                const tag = `AL${String(tagCounter).padStart(7, '0')}`;

                try {
                    const result = await generateTelemetryWithAI(model, proc, tag, fileInfo.objectName, token);
                    if (!result.generated) {
                        skippedReasons.push(`${fileInfo.objectName}.${proc.name}: ${result.skipReason || 'no telemetry needed'}`);
                        continue;
                    }

                    proposals.push({
                        file: fileInfo,
                        procedure: proc,
                        telemetry: result.generated,
                        tag,
                    });
                    tagCounter++;
                } catch (err) {
                    if (err instanceof vscode.CancellationError) { break; }
                    console.error(`[ALP Telemetry Agent] Failed for ${fileInfo.objectName}.${proc.name}:`, err);
                }
            }
        }
    });

    if (proposals.length === 0) {
        const msg = skippedReasons.length > 0
            ? `No telemetry needed. ${skippedReasons.length} procedures analyzed.`
            : 'No procedures found to instrument.';
        vscode.window.showInformationMessage(msg, 'Show Details').then(choice => {
            if (choice === 'Show Details') { showSkipReasons(skippedReasons); }
        });
        return;
    }

    // Show preview for confirmation
    const confirmed = await showPreview(proposals, skippedReasons);
    if (!confirmed) { return; }

    // Apply all proposals
    await applyProposals(proposals);
}

async function selectModel(): Promise<vscode.LanguageModelChat | null> {
    let models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
    if (models.length === 0) {
        models = await vscode.lm.selectChatModels({ family: 'gpt-4o-mini' });
    }
    if (models.length === 0) {
        models = await vscode.lm.selectChatModels({ family: 'claude-sonnet' });
    }
    if (models.length === 0) {
        models = await vscode.lm.selectChatModels({});
    }
    if (models.length === 0) {
        vscode.window.showErrorMessage('No language model available. Ensure GitHub Copilot is active and you have access to Copilot Chat.');
        return null;
    }
    return models[0];
}

function parseALFile(document: vscode.TextDocument): ALFileInfo | null {
    const text = document.getText();

    // Extract object declaration
    const objectMatch = text.match(/^\s*(codeunit|table|page|report|xmlport|query|enum|interface|permissionset|pageextension|tableextension|reportextension|enumextension|controladdin)\s+(\d+)\s+"?([^"\n{]+)"?\s*/im);
    if (!objectMatch) { return null; }

    const objectType = objectMatch[1];
    const objectName = objectMatch[3].trim();

    const procedures = parseProcedureBlocks(document);

    return {
        uri: document.uri,
        objectName,
        objectType,
        procedures,
    };
}

async function showPreview(proposals: TelemetryProposal[], skippedReasons: string[]): Promise<boolean> {
    // Group proposals by file
    const byFile = new Map<string, TelemetryProposal[]>();
    for (const p of proposals) {
        const key = vscode.workspace.asRelativePath(p.file.uri);
        if (!byFile.has(key)) { byFile.set(key, []); }
        byFile.get(key)!.push(p);
    }

    // Build preview items
    const items: (vscode.QuickPickItem & { apply?: boolean })[] = [];

    items.push({
        label: `$(check) Apply All — Instrument ${proposals.length} procedure(s) across ${byFile.size} file(s)`,
        apply: true,
    });
    items.push({
        label: '$(close) Cancel',
        description: 'No changes will be made',
        apply: false,
    });
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

    for (const [file, fileProposals] of byFile) {
        items.push({
            label: `$(file) ${file}`,
            description: `${fileProposals[0].file.objectType} "${fileProposals[0].file.objectName}" — ${fileProposals.length} procedure(s)`,
            detail: fileProposals.map(p => {
                const eventMatch = p.telemetry.code.match(/Log(?:Usage|Error)\([^,]+,\s*'[^']+',\s*'([^']+)'/);
                const eventName = eventMatch ? eventMatch[1] : 'telemetry';
                return `    ${p.procedure.name} → "${eventName}"`;
            }).join('\n'),
        });
    }

    if (skippedReasons.length > 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: `$(info) ${skippedReasons.length} procedure(s) skipped (no telemetry needed)`,
        });
    }

    const result = await vscode.window.showQuickPick(items, {
        title: 'ALP: Telemetry Preview — Confirm Changes',
        placeHolder: 'Review proposed telemetry, then select Apply All or Cancel',
    });

    return result?.apply === true;
}

async function applyProposals(proposals: TelemetryProposal[]): Promise<void> {
    // Group by URI
    const byUri = new Map<string, TelemetryProposal[]>();
    for (const p of proposals) {
        const key = p.file.uri.toString();
        if (!byUri.has(key)) { byUri.set(key, []); }
        byUri.get(key)!.push(p);
    }

    // Apply edits to make documents dirty (changes are visible but NOT saved)
    const edit = new vscode.WorkspaceEdit();
    const affectedUris: vscode.Uri[] = [];

    for (const [, fileProposals] of byUri) {
        fileProposals.sort((a, b) => b.procedure.line - a.procedure.line);
        const document = await vscode.workspace.openTextDocument(fileProposals[0].file.uri);
        affectedUris.push(fileProposals[0].file.uri);
        for (const proposal of fileProposals) {
            applyTelemetryEdit(edit, document, proposal.procedure, proposal.telemetry);
        }
    }

    // Track line counts before applying so we can compute inserted line ranges
    const lineCountsBefore = new Map<string, number>();
    for (const uri of affectedUris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        lineCountsBefore.set(uri.toString(), doc.lineCount);
    }

    await vscode.workspace.applyEdit(edit);

    // Highlight inserted lines with green background
    const decoratedEditors: vscode.TextEditor[] = [];
    for (const uri of affectedUris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });

        const beforeCount = lineCountsBefore.get(uri.toString()) || 0;
        const afterCount = doc.lineCount;
        const insertedCount = afterCount - beforeCount;

        if (insertedCount > 0) {
            const ranges = findInsertedRanges(doc, edit, uri);
            editor.setDecorations(addedLineDecoration, ranges);
            decoratedEditors.push(editor);

            if (ranges.length > 0) {
                editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
            }
        }
    }

    // Persistent status bar buttons — don't block the editor
    const totalFiles = affectedUris.length;
    const acceptBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    acceptBtn.text = '$(check) Accept Telemetry';
    acceptBtn.tooltip = `Save telemetry changes to ${totalFiles} file(s)`;
    acceptBtn.color = new vscode.ThemeColor('testing.iconPassed');
    acceptBtn.command = 'alProductivityPack.telemetryAccept';
    acceptBtn.show();

    const discardBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
    discardBtn.text = '$(x) Discard';
    discardBtn.tooltip = 'Revert all telemetry changes';
    discardBtn.color = new vscode.ThemeColor('testing.iconFailed');
    discardBtn.command = 'alProductivityPack.telemetryDiscard';
    discardBtn.show();

    const infoBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 998);
    infoBtn.text = `$(info) ${proposals.length} procedures • ${totalFiles} file(s)`;
    infoBtn.tooltip = 'Review the green highlighted lines, then Accept or Discard';
    infoBtn.show();

    // Register temporary commands for accept/discard
    const cleanup = () => {
        acceptBtn.dispose();
        discardBtn.dispose();
        infoBtn.dispose();
        for (const editor of decoratedEditors) {
            editor.setDecorations(addedLineDecoration, []);
        }
        acceptDisposable.dispose();
        discardDisposable.dispose();
    };

    const acceptDisposable = vscode.commands.registerCommand('alProductivityPack.telemetryAccept', async () => {
        cleanup();
        for (const uri of affectedUris) {
            const doc = await vscode.workspace.openTextDocument(uri);
            await doc.save();
        }
        vscode.window.showInformationMessage(`Telemetry saved to ${totalFiles} file(s).`);
    });

    const discardDisposable = vscode.commands.registerCommand('alProductivityPack.telemetryDiscard', async () => {
        cleanup();
        for (const uri of affectedUris) {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
        vscode.window.showInformationMessage('Telemetry changes discarded. No files were modified.');
    });
}

/**
 * Finds ranges of inserted lines by examining the workspace edit's insertions.
 */
function findInsertedRanges(doc: vscode.TextDocument, edit: vscode.WorkspaceEdit, uri: vscode.Uri): vscode.Range[] {
    const edits = edit.get(uri);
    if (!edits) { return []; }

    const ranges: vscode.Range[] = [];

    // Sort edits by position (ascending for post-apply line calculation)
    const sorted = [...edits].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
    });

    let lineOffset = 0;
    for (const textEdit of sorted) {
        if (textEdit.range.isEmpty && textEdit.newText) {
            const insertedLines = textEdit.newText.split('\n').length - 1;
            const startLine = textEdit.range.start.line + lineOffset;

            if (insertedLines > 0) {
                // Highlight the inserted lines (skip empty trailing line from \n)
                for (let i = 0; i < insertedLines; i++) {
                    const lineIdx = startLine + i;
                    if (lineIdx < doc.lineCount && doc.lineAt(lineIdx).text.trim() !== '') {
                        ranges.push(new vscode.Range(lineIdx, 0, lineIdx, doc.lineAt(lineIdx).text.length));
                    }
                }
                lineOffset += insertedLines;
            } else if (textEdit.newText.trim() !== '') {
                // Inline insertion on same line
                const lineIdx = startLine;
                if (lineIdx < doc.lineCount) {
                    ranges.push(new vscode.Range(lineIdx, 0, lineIdx, doc.lineAt(lineIdx).text.length));
                }
            }
        }
    }

    return ranges;
}

function showSkipReasons(reasons: string[]): void {
    const output = vscode.window.createOutputChannel('ALP Telemetry Agent');
    output.clear();
    output.appendLine(`Skipped procedures (${reasons.length}):`);
    output.appendLine('');
    reasons.forEach(r => output.appendLine(`\u2022 ${r}`));
    output.show();
}

// --- AI Generation ---

async function generateTelemetryWithAI(
    model: vscode.LanguageModelChat,
    proc: ALProcedureBlock,
    tag: string,
    featureName: string,
    token: vscode.CancellationToken,
): Promise<TelemetryResult> {
    const userMessage = `Analyze this AL ${proc.type} "${proc.name}" and generate telemetry.
Feature name: '${featureName}'
Event tag: '${tag}'

Output ONLY the telemetry line(s) to add — do NOT repeat or restructure the original code.
READ the code carefully — the EventName must describe EXACTLY what this procedure does (e.g., "Item unit of measure inserted", "Job approval status set to pending"), NOT generic phrases like "Records processed".

Typical output (3-4 lines):
//VAR: FeatureTelemetry: Codeunit "Feature Telemetry";
//VAR: CustomDimensions: Dictionary of [Text, Text];
CustomDimensions.Add('ItemNo', ItemNo);
FeatureTelemetry.LogUsage('${tag}', '${featureName}', '<specific action in past tense>', CustomDimensions);

If it's a trivial helper with no business side effects, output: // No telemetry needed: [reason]

Here is the procedure:

${proc.code}`;

    const messages = [
        vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
        vscode.LanguageModelChatMessage.User(userMessage),
    ];

    const response = await model.sendRequest(messages, {}, token);

    let result = '';
    for await (const chunk of response.text) {
        result += chunk;
    }

    console.log(`[ALP Telemetry Agent] ${featureName}.${proc.name} response:`, result.substring(0, 200));

    if (!result.trim()) { return { generated: null, skipReason: 'empty response from model' }; }

    return parseLMResponse(proc.name, result);
}

function parseLMResponse(procedureName: string, response: string): TelemetryResult {
    // Strip markdown code fences that LMs love to add
    let cleaned = response
        .replace(/^```[\w]*\n?/gm, '')
        .replace(/^```\s*$/gm, '')
        .trim();

    // If the agent decided no telemetry is needed, extract the reason
    if (cleaned.startsWith('// No telemetry needed')) {
        const reason = cleaned.replace('// No telemetry needed:', '').replace('// No telemetry needed', '').trim();
        return { generated: null, skipReason: reason || 'no telemetry needed' };
    }

    // Sanitize common LM mistakes in AL code
    cleaned = cleaned
        .replace(/(\w+)\.ToString\(\)/g, 'Format($1)')
        .replace(/(\w+)\.AsText/g, 'Format($1)')
        .replace(/\bDurationToString\(([^)]+)\)/g, 'Format($1)')
        .replace(/\bDurationInSeconds\b/g, 'Format(CurrentDateTime - StartTime)');

    const lines = cleaned.split('\n');
    const varDeclarations: string[] = [];
    const codeLines: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' && codeLines.length === 0 && varDeclarations.length === 0) { continue; }

        if (trimmed.startsWith('//VAR:')) {
            varDeclarations.push(trimmed.replace('//VAR:', '').trim());
        } else {
            codeLines.push(line);
        }
    }

    // If there's no actual executable code, skip
    if (codeLines.every(l => l.trim() === '' || l.trim().startsWith('//'))) {
        return { generated: null, skipReason: 'model returned only comments' };
    }

    return {
        generated: {
            procedureName,
            code: codeLines.join('\n'),
            varDeclarations,
        },
    };
}

// --- Edit Application ---

function applyTelemetryEdit(
    edit: vscode.WorkspaceEdit,
    document: vscode.TextDocument,
    proc: ALProcedureBlock,
    generated: GeneratedTelemetry,
): void {
    // Split code at //BEGIN: marker — code after //BEGIN: goes at top of body (e.g. timing start)
    // Default (non-marked) code goes before end; (after operations complete)
    const parts = generated.code.split('//BEGIN:');
    const endCode = parts[0].trim();   // default = before end;
    const beginCode = parts.length > 1 ? parts[1].trim() : '';

    // Insert variable declarations
    if (generated.varDeclarations.length > 0) {
        const varInsertInfo = findVarInsertPoint(document, proc.line);
        if (varInsertInfo) {
            const varBlock = generated.varDeclarations
                .map(v => `${varInsertInfo.indent}${v}`)
                .join('\n') + '\n';
            edit.insert(document.uri, new vscode.Position(varInsertInfo.line, 0), varBlock);
        } else {
            // No var section — create one before begin
            const beginLine = findBeginLineFor(document, proc.line);
            if (beginLine !== -1) {
                const baseIndent = document.lineAt(beginLine).text.match(/^(\s*)/)?.[1] ?? '    ';
                const varBlock = `${baseIndent}var\n` +
                    generated.varDeclarations.map(v => `${baseIndent}    ${v}`).join('\n') + '\n';
                edit.insert(document.uri, new vscode.Position(beginLine, 0), varBlock);
            }
        }
    }

    // Insert code at top of body (after begin) — only for //BEGIN: marked code like timing start
    if (beginCode) {
        const beginLine = findBeginLineFor(document, proc.line);
        if (beginLine !== -1) {
            const indent = getBodyIndent(document, beginLine);
            const indentedCode = beginCode.split('\n')
                .map(l => l.trim() ? `${indent}${l.trimStart()}` : '')
                .join('\n');
            edit.insert(document.uri, new vscode.Position(beginLine + 1, 0), indentedCode + '\n');
        }
    }

    // Insert default code before end; (after all operations complete)
    if (endCode) {
        const endLine = findLastEndLine(document, proc.line, proc.endLine);
        if (endLine !== -1) {
            const indent = getBodyIndent(document, findBeginLineFor(document, proc.line));
            const indentedEnd = endCode.split('\n')
                .map(l => l.trim() ? `${indent}${l.trimStart()}` : '')
                .join('\n');
            edit.insert(document.uri, new vscode.Position(endLine, 0), indentedEnd + '\n');
        }
    }
}

// --- Parsing helpers ---

function parseProcedureBlocks(document: vscode.TextDocument): ALProcedureBlock[] {
    const procedures: ALProcedureBlock[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const procMatch = line.match(/^\s*(local\s+)?(?:internal\s+)?procedure\s+(\w+|"[^"]+")\s*\(/i);
        const triggerMatch = !procMatch ? line.match(/^\s*trigger\s+(\w+|"[^"]+")\s*\(/i) : null;

        if (procMatch || triggerMatch) {
            const name = procMatch ? procMatch[2].replace(/"/g, '') : triggerMatch![1].replace(/"/g, '');
            const type: 'procedure' | 'trigger' = procMatch ? 'procedure' : 'trigger';
            const endLine = findProcedureEnd(lines, i);

            // Include attributes above the procedure (like [EventSubscriber], [TryFunction], etc.)
            let startLine = i;
            for (let j = i - 1; j >= 0; j--) {
                const above = lines[j].trim();
                if (above.startsWith('[') || above === '') {
                    startLine = j;
                } else {
                    break;
                }
            }
            while (startLine < i && lines[startLine].trim() === '') {
                startLine++;
            }

            const code = lines.slice(startLine, endLine + 1).join('\n');
            procedures.push({ name, line: i, endLine, type, code });
        }
    }

    return procedures;
}

function findProcedureEnd(lines: string[], startLine: number): number {
    let depth = 0;
    let inBody = false;

    for (let i = startLine; i < lines.length; i++) {
        const trimmed = lines[i].trim().toLowerCase();

        if (/^begin$/.test(trimmed)) {
            depth++;
            inBody = true;
        } else if (/\bcase\b.+\bof\b/.test(trimmed) && inBody) {
            depth++;
        } else if (/^end;?$/.test(trimmed) && inBody) {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return Math.min(startLine + 50, lines.length - 1);
}

function findBeginLineFor(document: vscode.TextDocument, procLine: number): number {
    for (let i = procLine; i < Math.min(procLine + 20, document.lineCount); i++) {
        if (/^\s*begin\s*$/i.test(document.lineAt(i).text)) {
            return i;
        }
    }
    return -1;
}

function findLastEndLine(document: vscode.TextDocument, procLine: number, endLine: number): number {
    for (let i = endLine; i > procLine; i--) {
        if (/^\s*end;\s*$/i.test(document.lineAt(i).text)) {
            return i;
        }
    }
    return -1;
}

function findVarInsertPoint(document: vscode.TextDocument, procLine: number): { line: number; indent: string } | null {
    for (let i = procLine + 1; i < Math.min(procLine + 20, document.lineCount); i++) {
        const lineText = document.lineAt(i).text;

        if (/^\s*var\s*$/i.test(lineText)) {
            for (let j = i + 1; j < Math.min(procLine + 25, document.lineCount); j++) {
                if (/^\s*begin\s*$/i.test(document.lineAt(j).text)) {
                    for (let k = i + 1; k < j; k++) {
                        const match = document.lineAt(k).text.match(/^(\s+)/);
                        if (match) { return { line: j, indent: match[1] }; }
                    }
                    const varIndent = lineText.match(/^(\s*)/)?.[1] ?? '';
                    return { line: j, indent: varIndent + '    ' };
                }
            }
        }

        if (/^\s*begin\s*$/i.test(lineText)) {
            return null;
        }
    }
    return null;
}

function getBodyIndent(document: vscode.TextDocument, beginLine: number): string {
    if (beginLine + 1 < document.lineCount) {
        const nextLine = document.lineAt(beginLine + 1).text;
        const match = nextLine.match(/^(\s+)/);
        if (match) { return match[1]; }
    }
    return '        ';
}
