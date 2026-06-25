import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Scans the workspace for existing AL objects and finds the next available IDs
 * for tables, pages, codeunits, and page extensions.
 */
export async function detectNextObjectIds(): Promise<{ table: number; page: number; codeunit: number; pageExtension: number }> {
    const OBJECT_PATTERN = /^\s*(codeunit|table|tableextension|page|pageextension|report|xmlport|query|enum|enumextension)\s+(\d+)/i;

    const maxIds: Record<string, number> = {
        table: 50000,
        page: 50000,
        codeunit: 50000,
        pageextension: 50000
    };

    const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,node_modules,out}/**');

    for (const file of alFiles) {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        const lines = text.split('\n');

        for (const line of lines) {
            const match = line.match(OBJECT_PATTERN);
            if (match) {
                const objType = match[1].toLowerCase();
                const objId = parseInt(match[2], 10);
                if (maxIds[objType] !== undefined && objId >= maxIds[objType]) {
                    maxIds[objType] = objId;
                }
            }
        }
    }

    return {
        table: maxIds['table'] + 1,
        page: maxIds['page'] + 1,
        codeunit: maxIds['codeunit'] + 1,
        pageExtension: maxIds['pageextension'] + 1
    };
}

/**
 * Parses fields from a generated integration table .al file.
 */
export function parseIntegrationTableFields(content: string): { fieldName: string; fieldNo: number; dataType: string }[] {
    const fields: { fieldName: string; fieldNo: number; dataType: string }[] = [];
    const fieldPattern = /field\((\d+);\s*"?([^";]+)"?\s*;\s*([^)]+)\)/gi;

    let match;
    while ((match = fieldPattern.exec(content)) !== null) {
        fields.push({
            fieldNo: parseInt(match[1], 10),
            fieldName: match[2].trim(),
            dataType: match[3].trim()
        });
    }

    return fields;
}

/**
 * Parses fields from a BC table .al file.
 */
export function parseBCTableFields(content: string): { fieldName: string; fieldNo: number; dataType: string }[] {
    return parseIntegrationTableFields(content); // Same syntax
}

/**
 * Finds the BC table file in the workspace by name.
 */
export async function findTableFile(tableName: string): Promise<vscode.Uri | undefined> {
    const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,node_modules,out}/**');

    const tablePattern = new RegExp(`^\\s*table\\s+\\d+\\s+"?${escapeRegex(tableName)}"?`, 'i');

    for (const file of alFiles) {
        const doc = await vscode.workspace.openTextDocument(file);
        const firstLines = doc.getText().split('\n').slice(0, 5).join('\n');
        if (tablePattern.test(firstLines)) {
            return file;
        }
    }
    return undefined;
}

/**
 * Locates altpgen.exe from the AL Language VS Code extension.
 */
export async function findAltpgen(): Promise<string | undefined> {
    const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
    if (alExtension) {
        const extPath = alExtension.extensionPath;
        const altpgenPath = path.join(extPath, 'bin', 'altpgen.exe');
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(altpgenPath));
            return altpgenPath;
        } catch {
            // Try common alternate paths
        }
    }

    // Fallback: ask user
    return undefined;
}

/**
 * Gets the .alpackages path for the current project.
 */
export function getAlPackagesPath(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return '.alpackages'; }
    return path.join(workspaceFolders[0].uri.fsPath, '.alpackages');
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
