import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface AltpgenTableField {
    id: number;
    name: string;
    type: string;
    externalName: string;
    caption: string;
}

export interface AltpgenTableInfo {
    tableId: number;
    tableName: string;
    externalName: string;
    primaryKeyField: string;
    primaryKeyFieldId: number;
    modifiedOnFieldId: number;
    fields: AltpgenTableField[];
}

/**
 * Find and parse the altpgen-generated .al file from the workspace.
 * Looks for a table with TableType = CDS and matching ExternalName.
 */
export async function parseAltpgenOutput(entityLogicalName: string): Promise<AltpgenTableInfo | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return undefined; }

    const projectFolder = workspaceFolders[0].uri.fsPath;

    // Search for .al files in the project root (altpgen puts them there)
    const alFiles = fs.readdirSync(projectFolder).filter(f => f.endsWith('.al'));

    for (const fileName of alFiles) {
        const filePath = path.join(projectFolder, fileName);
        const content = fs.readFileSync(filePath, 'utf8');

        // Check if this is a CDS table with matching external name
        if (!content.includes('TableType = CDS')) { continue; }

        const externalNameMatch = content.match(/ExternalName\s*=\s*'([^']+)'/);
        if (!externalNameMatch || externalNameMatch[1] !== entityLogicalName) { continue; }

        // Found it — parse the table
        return parseTableContent(content);
    }

    // Also search in subdirectories
    const alFilesDeep = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,node_modules}/**');
    for (const fileUri of alFilesDeep) {
        try {
            const content = fs.readFileSync(fileUri.fsPath, 'utf8');
            if (!content.includes('TableType = CDS')) { continue; }

            const externalNameMatch = content.match(/ExternalName\s*=\s*'([^']+)'/);
            if (!externalNameMatch || externalNameMatch[1] !== entityLogicalName) { continue; }

            return parseTableContent(content);
        } catch { /* skip */ }
    }

    return undefined;
}

function parseTableContent(content: string): AltpgenTableInfo | undefined {
    // Parse table header: table 50102 "CDS Position"
    const headerMatch = content.match(/^\s*table\s+(\d+)\s+"?([^"\r\n{]+)"?/m);
    if (!headerMatch) { return undefined; }

    const tableId = parseInt(headerMatch[1], 10);
    const tableName = headerMatch[2].trim();

    // Parse ExternalName
    const externalNameMatch = content.match(/ExternalName\s*=\s*'([^']+)'/);
    const externalName = externalNameMatch ? externalNameMatch[1] : '';

    // Parse fields
    const fields: AltpgenTableField[] = [];
    const fieldRegex = /field\((\d+);\s*([^;]+);\s*([^)]+)\)/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(content)) !== null) {
        const fieldId = parseInt(fieldMatch[1], 10);
        const fieldName = fieldMatch[2].trim();
        const fieldType = fieldMatch[3].trim();

        // Get ExternalName for this field
        const fieldStart = fieldMatch.index;
        const nextFieldStart = content.indexOf('field(', fieldStart + 1);
        const fieldBlock = content.substring(fieldStart, nextFieldStart > 0 ? nextFieldStart : undefined);

        const extNameMatch = fieldBlock.match(/ExternalName\s*=\s*'([^']+)'/);
        const captionMatch = fieldBlock.match(/Caption\s*=\s*'([^']+)'/);

        fields.push({
            id: fieldId,
            name: fieldName,
            type: fieldType,
            externalName: extNameMatch ? extNameMatch[1] : fieldName.toLowerCase(),
            caption: captionMatch ? captionMatch[1] : fieldName
        });
    }

    // Parse primary key
    const pkMatch = content.match(/key\(PK;\s*([^)]+)\)/);
    const primaryKeyField = pkMatch ? pkMatch[1].trim() : (fields.length > 0 ? fields[0].name : 'Id');
    const pkField = fields.find(f => f.name === primaryKeyField);
    const primaryKeyFieldId = pkField ? pkField.id : 1;

    // Find ModifiedOn field
    const modifiedOnField = fields.find(f => f.name === 'ModifiedOn');
    const modifiedOnFieldId = modifiedOnField ? modifiedOnField.id : 4;

    return {
        tableId,
        tableName,
        externalName,
        primaryKeyField,
        primaryKeyFieldId,
        modifiedOnFieldId,
        fields
    };
}
