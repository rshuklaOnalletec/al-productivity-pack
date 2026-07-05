import * as vscode from 'vscode';

interface ALProcedure {
    name: string;
    line: number;
    type: 'procedure' | 'trigger';
    isLocal: boolean;
}

interface TelemetryConfig {
    tagPrefix: string;
    verbosity: string;
    dataClassification: string;
    includeParameters: boolean;
    helperCodeunit: boolean;
}

/**
 * Scaffolds Session.LogMessage() telemetry calls into AL procedures/triggers.
 */
export async function addTelemetryCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'al') {
        vscode.window.showWarningMessage('Open an AL file to add telemetry.');
        return;
    }

    const document = editor.document;
    const procedures = parseProcedures(document);

    if (procedures.length === 0) {
        vscode.window.showInformationMessage('No procedures or triggers found in this file.');
        return;
    }

    // Step 1: Pick procedures to instrument
    const items = procedures.map(proc => ({
        label: `$(${proc.type === 'trigger' ? 'zap' : 'symbol-method'}) ${proc.name}`,
        description: proc.type === 'trigger' ? 'trigger' : (proc.isLocal ? 'local procedure' : 'procedure'),
        detail: `Line ${proc.line + 1}`,
        picked: !proc.isLocal, // Pre-select non-local procedures
        proc,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select procedures to add telemetry to...',
        title: 'ALP: Add Telemetry',
    });

    if (!selected || selected.length === 0) { return; }

    // Step 2: Configure telemetry options
    const config = await getTelemetryConfig();
    if (!config) { return; }

    // Step 3: Generate and insert telemetry code
    const edit = new vscode.WorkspaceEdit();
    const selectedProcs = selected.map(s => s.proc);
    let tagCounter = 1;

    for (const proc of selectedProcs) {
        const insertLine = findInsertionPoint(document, proc.line);
        if (insertLine === -1) { continue; }

        const tag = `${config.tagPrefix}${String(tagCounter).padStart(4, '0')}`;
        const indent = detectIndent(document, insertLine);
        const snippet = generateLogMessage(proc, tag, config, indent);

        // If using custom dimensions, inject variable declaration in var section
        if (config.includeParameters) {
            const varInsert = findOrCreateVarSection(document, proc.line);
            if (varInsert) {
                // Existing var section found — append variable
                edit.insert(document.uri, new vscode.Position(varInsert.line, 0),
                    `${varInsert.indent}TelemetryCustomDimensions: Dictionary of [Text, Text];\n`);
            } else {
                // No var section — insert "var" + declaration before "begin"
                const beginLine = findBeginLine(document, proc.line);
                if (beginLine !== -1) {
                    const beginIndent = document.lineAt(beginLine).text.match(/^(\s*)/)?.[1] ?? '    ';
                    edit.insert(document.uri, new vscode.Position(beginLine, 0),
                        `${beginIndent}var\n${beginIndent}    TelemetryCustomDimensions: Dictionary of [Text, Text];\n`);
                }
            }
        }

        edit.insert(document.uri, new vscode.Position(insertLine, 0), snippet);
        tagCounter++;
    }

    await vscode.workspace.applyEdit(edit);

    // Step 4: Optionally generate helper codeunit
    if (config.helperCodeunit) {
        await generateHelperCodeunit(config, selectedProcs);
    }

    vscode.window.showInformationMessage(
        `Telemetry added to ${selectedProcs.length} procedure(s) with tag prefix "${config.tagPrefix}".`
    );
}

async function getTelemetryConfig(): Promise<TelemetryConfig | undefined> {
    // Tag prefix
    const tagPrefix = await vscode.window.showInputBox({
        prompt: 'Telemetry tag prefix (e.g., MYAPP for MYAPP0001, MYAPP0002...)',
        placeHolder: 'MYAPP',
        value: 'MYAPP',
        validateInput: (value) => {
            if (!value || !/^[A-Z]{2,10}$/.test(value)) {
                return 'Use 2-10 uppercase letters (e.g., MYAPP, CRM, INV)';
            }
            return undefined;
        },
    });
    if (!tagPrefix) { return undefined; }

    // Verbosity
    const verbosity = await vscode.window.showQuickPick(
        ['Normal', 'Verbose', 'Warning'],
        { placeHolder: 'Default verbosity level', title: 'Telemetry Verbosity' }
    );
    if (!verbosity) { return undefined; }

    // Data classification
    const dataClassification = await vscode.window.showQuickPick(
        [
            { label: 'SystemMetadata', description: '(Recommended) Always sent to App Insights' },
            { label: 'CustomerContent', description: 'WARNING: Not sent to App Insights for privacy' },
            { label: 'OrganizationIdentifiableInformation', description: 'WARNING: Not sent to App Insights for privacy' },
        ],
        { placeHolder: 'Data classification', title: 'Data Classification' }
    );
    if (!dataClassification) { return undefined; }

    // Include parameters as custom dimensions?
    const includeParams = await vscode.window.showQuickPick(
        [{ label: 'Yes', description: 'Add procedure parameters as custom dimensions' },
         { label: 'No', description: 'Only log procedure entry' }],
        { placeHolder: 'Include parameters in telemetry?', title: 'Custom Dimensions' }
    );
    if (!includeParams) { return undefined; }

    // Generate helper codeunit?
    const helper = await vscode.window.showQuickPick(
        [{ label: 'Yes', description: 'Create a reusable TelemetryHelper codeunit' },
         { label: 'No', description: 'Use inline Session.LogMessage calls' }],
        { placeHolder: 'Generate a telemetry helper codeunit?', title: 'Helper Codeunit' }
    );
    if (!helper) { return undefined; }

    return {
        tagPrefix,
        verbosity,
        dataClassification: typeof dataClassification === 'string' ? dataClassification : dataClassification.label,
        includeParameters: includeParams.label === 'Yes',
        helperCodeunit: helper.label === 'Yes',
    };
}

function parseProcedures(document: vscode.TextDocument): ALProcedure[] {
    const procedures: ALProcedure[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match procedures: [local] procedure Name(...)
        const procMatch = line.match(/^\s*(local\s+)?(?:internal\s+)?procedure\s+(\w+|"[^"]+")\s*\(/i);
        if (procMatch) {
            procedures.push({
                name: procMatch[2].replace(/"/g, ''),
                line: i,
                type: 'procedure',
                isLocal: !!procMatch[1],
            });
            continue;
        }

        // Match triggers: trigger Name()
        const triggerMatch = line.match(/^\s*trigger\s+(\w+|"[^"]+")\s*\(/i);
        if (triggerMatch) {
            procedures.push({
                name: triggerMatch[1].replace(/"/g, ''),
                line: i,
                type: 'trigger',
                isLocal: false,
            });
        }
    }

    return procedures;
}

/**
 * Finds the first line inside the procedure body (after `begin`).
 */
function findInsertionPoint(document: vscode.TextDocument, procLine: number): number {
    for (let i = procLine; i < Math.min(procLine + 20, document.lineCount); i++) {
        const line = document.lineAt(i).text;
        if (/^\s*begin\s*$/i.test(line)) {
            return i + 1;
        }
    }
    return -1;
}

/**
 * Finds the `begin` line for a procedure.
 */
function findBeginLine(document: vscode.TextDocument, procLine: number): number {
    for (let i = procLine; i < Math.min(procLine + 20, document.lineCount); i++) {
        if (/^\s*begin\s*$/i.test(document.lineAt(i).text)) {
            return i;
        }
    }
    return -1;
}

/**
 * Finds the var section for a procedure, or identifies where to create one.
 * Returns the line to insert the variable declaration and the indent to use.
 */
function findOrCreateVarSection(document: vscode.TextDocument, procLine: number): { line: number; indent: string } | null {
    // Look between procedure line and `begin` for an existing `var` keyword
    for (let i = procLine + 1; i < Math.min(procLine + 20, document.lineCount); i++) {
        const lineText = document.lineAt(i).text;

        if (/^\s*begin\s*$/i.test(lineText)) {
            // No var section found before begin — need to check if there's a var above
            // Look backwards from begin for var
            for (let j = i - 1; j > procLine; j--) {
                if (/^\s*var\s*$/i.test(document.lineAt(j).text)) {
                    // Found var section, insert after last variable declaration (just before begin)
                    const indent = getVarIndent(document, j, i);
                    return { line: i, indent };
                }
            }
            // No var section exists — we'll insert one just before begin
            // But we need to insert both "var" and the declaration
            // Return the line of `begin` so caller inserts before it
            return null; // handled separately below
        }

        if (/^\s*var\s*$/i.test(lineText)) {
            // Found var keyword — find the last var declaration line (just before begin)
            for (let j = i + 1; j < Math.min(procLine + 20, document.lineCount); j++) {
                if (/^\s*begin\s*$/i.test(document.lineAt(j).text)) {
                    const indent = getVarIndent(document, i, j);
                    return { line: j, indent };
                }
            }
        }
    }
    return null;
}

function getVarIndent(document: vscode.TextDocument, varLine: number, beginLine: number): string {
    // Use indent of existing variable declarations if any
    for (let i = varLine + 1; i < beginLine; i++) {
        const text = document.lineAt(i).text;
        if (text.trim().length > 0) {
            const match = text.match(/^(\s+)/);
            if (match) { return match[1]; }
        }
    }
    // Default: indent one level from var keyword
    const varIndent = document.lineAt(varLine).text.match(/^(\s*)/)?.[1] ?? '';
    return varIndent + '    ';
}

function detectIndent(document: vscode.TextDocument, line: number): string {
    if (line < document.lineCount) {
        const text = document.lineAt(line).text;
        const match = text.match(/^(\s+)/);
        if (match) { return match[1]; }
    }
    return '        '; // default 8 spaces
}

function generateLogMessage(
    proc: ALProcedure,
    tag: string,
    config: TelemetryConfig,
    indent: string
): string {
    // MS convention: "Object ActionInPastTense" pattern for messages
    const message = `${proc.name} ${proc.type === 'trigger' ? 'triggered' : 'executed'}`;

    if (!config.includeParameters) {
        // Use dimension overload with meaningful ProcedureName dimension
        return `${indent}Session.LogMessage('${tag}', '${message}', Verbosity::${config.verbosity}, DataClassification::${config.dataClassification}, TelemetryScope::ExtensionPublisher, 'ProcedureName', '${proc.name}');\n`;
    }

    // With custom dimensions dictionary (keys auto-prefixed with "al" in App Insights)
    const lines = [
        `${indent}// Telemetry: ${tag} - ${proc.name}`,
        `${indent}TelemetryCustomDimensions.Add('ProcedureName', '${proc.name}');`,
        `${indent}Session.LogMessage('${tag}', '${message}', Verbosity::${config.verbosity}, DataClassification::${config.dataClassification}, TelemetryScope::ExtensionPublisher, TelemetryCustomDimensions);`,
        '',
    ];
    return lines.join('\n') + '\n';
}

async function generateHelperCodeunit(config: TelemetryConfig, _procs: ALProcedure[]): Promise<void> {
    const content = `codeunit 50900 "Telemetry Helper"
{
    Access = Internal;

    /// <summary>
    /// Logs a telemetry message with standard dimensions.
    /// Use DataClassification::SystemMetadata to ensure events reach App Insights.
    /// Custom dimension keys are auto-prefixed with "al" in App Insights (e.g., ProcedureName -> alProcedureName).
    /// </summary>
    procedure LogEvent(EventId: Text; EventMessage: Text; Dimensions: Dictionary of [Text, Text])
    begin
        Session.LogMessage(EventId, EventMessage, Verbosity::${config.verbosity}, DataClassification::${config.dataClassification}, TelemetryScope::ExtensionPublisher, Dimensions);
    end;

    /// <summary>
    /// Logs an error telemetry message.
    /// </summary>
    procedure LogError(EventId: Text; EventMessage: Text; Dimensions: Dictionary of [Text, Text])
    begin
        Session.LogMessage(EventId, EventMessage, Verbosity::Error, DataClassification::${config.dataClassification}, TelemetryScope::ExtensionPublisher, Dimensions);
    end;

    /// <summary>
    /// Creates standard custom dimensions with procedure context.
    /// Uses only SystemMetadata-safe fields (no EUII).
    /// </summary>
    procedure CreateDimensions(ProcedureName: Text; ObjectName: Text) Result: Dictionary of [Text, Text]
    begin
        Result.Add('ProcedureName', ProcedureName);
        Result.Add('ObjectName', ObjectName);
        Result.Add('CompanyName', CompanyName());
    end;
}
`;

    // Create the file in workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return; }

    const rootUri = workspaceFolders[0].uri;
    const fileUri = vscode.Uri.joinPath(rootUri, 'src', 'TelemetryHelper.Codeunit.al');

    // Check if it already exists
    try {
        await vscode.workspace.fs.stat(fileUri);
        const overwrite = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'TelemetryHelper.Codeunit.al already exists. Overwrite?',
        });
        if (overwrite !== 'Yes') { return; }
    } catch {
        // File doesn't exist — good
    }

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}
