/**
 * VS Code command handler for generating BC Page Scripts from repro steps.
 */

import * as vscode from 'vscode';
import { parseReproSteps, ParseResult } from './reproParser';
import { generatePageScriptYaml, generateFileName } from './yamlGenerator';
import { getFieldResolver, FieldResolver } from './fieldResolver';

const SAMPLE_INPUT = `# Example repro steps (delete this and paste your own):
# Supported verbs: Open, Click, Set, In "Part" Set, Confirm, Choose, Validate, Wait

Open "Sales Order List"
Click "New"
Open "Sales Order"
Set "Customer Name" = "10000"
In "SalesLines" Set "No." = "1000"
In "SalesLines" Set "Quantity" = "5"
Click "Release"
Click "Post"
Choose 2
Confirm "Yes"
`;

export async function generatePageScriptCommand(): Promise<void> {
    // Step 1: Get repro steps from user via input box or active editor
    const input = await getReproInput();
    if (!input) {
        return;
    }

    // Step 2: Parse the DSL
    const parseResult = parseReproSteps(input);

    // Show parse errors if any
    if (parseResult.errors.length > 0) {
        const errorMessages = parseResult.errors.map(e => `Line ${e.line}: ${e.message}`);
        const choice = await vscode.window.showWarningMessage(
            `${parseResult.errors.length} line(s) could not be parsed. Generate script with ${parseResult.steps.length} valid steps?`,
            { detail: errorMessages.join('\n'), modal: true },
            'Generate Anyway',
            'Cancel'
        );
        if (choice !== 'Generate Anyway') {
            return;
        }
    }

    if (parseResult.steps.length === 0) {
        vscode.window.showErrorMessage('No valid repro steps found. Check the format and try again.');
        return;
    }

    // Step 3: Ask for optional description
    const description = await vscode.window.showInputBox({
        prompt: 'Bug description (optional, used as filename)',
        placeHolder: 'e.g., Sales order posting fails for customer 10000'
    });

    // Step 4: Generate YAML (with field resolution from AL sources)
    const resolver = getFieldResolver();
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Indexing AL page fields...' },
        () => resolver.initialize()
    );

    // Step 4b: Check for unresolved fields and ask user to map them
    const userMappings = await promptUnresolvedFields(parseResult, resolver);
    if (userMappings === undefined) {
        return; // User cancelled
    }

    const safeName = (description || 'ReproRecording').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 40);
    const yaml = generatePageScriptYaml(parseResult, {
        name: safeName,
        description: description || 'Generated from repro steps',
        fieldResolver: resolver,
        fieldOverrides: userMappings
    });

    // Step 5: Save the file
    const fileName = generateFileName(description || undefined);
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders) {
        const targetDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.page-scripts');
        await vscode.workspace.fs.createDirectory(targetDir);
        const targetFile = vscode.Uri.joinPath(targetDir, fileName);
        await vscode.workspace.fs.writeFile(targetFile, Buffer.from(yaml, 'utf8'));

        const doc = await vscode.workspace.openTextDocument(targetFile);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`Page script generated: .page-scripts/${fileName}`);
    } else {
        // No workspace — open as untitled document
        const doc = await vscode.workspace.openTextDocument({ content: yaml, language: 'yaml' });
        await vscode.window.showTextDocument(doc);
    }
}

async function getReproInput(): Promise<string | undefined> {
    // Check if active editor has a selection — use that
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
        const selectedText = editor.document.getText(editor.selection);
        if (selectedText.trim().length > 0) {
            return selectedText;
        }
    }

    // Otherwise, open a multi-line input document for the user to type/paste steps
    const doc = await vscode.workspace.openTextDocument({
        content: SAMPLE_INPUT,
        language: 'markdown'
    });
    const inputEditor = await vscode.window.showTextDocument(doc, { preview: true });

    // Wait for user to confirm they're done editing
    const confirm = await vscode.window.showInformationMessage(
        'Paste your repro steps in the editor, then click "Generate Script".',
        { modal: false },
        'Generate Script',
        'Cancel'
    );

    if (confirm !== 'Generate Script') {
        return undefined;
    }

    const content = inputEditor.document.getText();
    // Close the temp document
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    return content;
}

/**
 * Find fields the resolver can't map and ask the user to provide the correct AL source field name.
 * Returns a Map of overrides, or undefined if the user cancelled.
 */
async function promptUnresolvedFields(
    parseResult: ParseResult,
    resolver: FieldResolver
): Promise<Map<string, string> | undefined> {
    // Collect all fields that can't be verified
    const unresolvedFields: { page: string; userField: string }[] = [];
    let currentPage = '';

    for (const step of parseResult.steps) {
        if (step.type === 'open' && step.page) {
            currentPage = step.page;
        }
        if (!currentPage) {
            continue;
        }

        const field = (step.type === 'input' || step.type === 'validate' || step.type === 'subpage-input')
            ? step.field
            : undefined;

        if (!field) {
            continue;
        }

        // If resolver knows the page AND the field → confident, skip
        if (resolver.isPageKnown(currentPage) && resolver.isFieldKnown(currentPage, field)) {
            continue;
        }

        // Field is unverified — collect it (deduplicate)
        const exists = unresolvedFields.some(
            u => u.page.toLowerCase() === currentPage.toLowerCase() && u.userField.toLowerCase() === field.toLowerCase()
        );
        if (!exists) {
            unresolvedFields.push({ page: currentPage, userField: field });
        }
    }

    if (unresolvedFields.length === 0) {
        return new Map();
    }

    // Ask user if they want to map unresolved fields
    const choice = await vscode.window.showWarningMessage(
        `${unresolvedFields.length} field name(s) couldn't be verified. These must match the AL source field name (not the UI caption). Review them?`,
        'Review Fields', 'Use As-Is', 'Cancel'
    );

    if (choice === 'Cancel') {
        return undefined;
    }
    if (choice === 'Use As-Is') {
        return new Map();
    }

    // Prompt for each unresolved field with QuickPick showing available fields
    const overrides = new Map<string, string>();
    for (const { page, userField } of unresolvedFields) {
        const availableFields = resolver.getFieldNames(page);

        let resolved: string | undefined;
        if (availableFields.length > 0) {
            // Show QuickPick with all fields from the page, pre-filtered by user's input
            const items: vscode.QuickPickItem[] = availableFields
                .sort((a, b) => a.localeCompare(b))
                .map(f => ({ label: f }));

            // Add the user's typed value as first option in case it's correct
            items.unshift({ label: userField, description: '(as typed)' });

            const pick = await vscode.window.showQuickPick(items, {
                title: `Page "${page}" — select field for "${userField}"`,
                placeHolder: 'Type to filter fields from this page...',
                matchOnDescription: true
            });

            if (pick === undefined) {
                return undefined; // User pressed Escape — cancel
            }
            resolved = pick.label;
        } else {
            // Page not indexed — fallback to InputBox
            resolved = await vscode.window.showInputBox({
                prompt: `Page "${page}": AL source field name for "${userField}"?`,
                placeHolder: 'e.g., Buy-from Vendor Name',
                value: userField
            });

            if (resolved === undefined) {
                return undefined;
            }
        }

        if (resolved && resolved !== userField) {
            const key = `${page.toLowerCase()}|${userField.toLowerCase()}`;
            overrides.set(key, resolved);
        }
    }

    return overrides;
}
