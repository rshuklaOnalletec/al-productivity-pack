import { ALField, ALExtension, ALReference } from '../types';

// Matches: tableextension 50100 "My Ext" extends "Sales Header"
const EXTENSION_PATTERN = /^\s*(tableextension|pageextension|enumextension|reportextension)\s+(\d+)\s+"?([^"{\n]+)"?\s+extends\s+"?([^"{\n]+)"?/i;

// Matches: field(50100; "My Field"; Code[20])
const FIELD_PATTERN = /^\s*field\s*\(\s*(\d+)\s*;\s*"?([^";]+)"?\s*;\s*([^)]+)\)/i;

// Matches: Record "Table Name" or Record TableName (quoted or unquoted)
const TABLE_REFERENCE_QUOTED = /Record\s+"([^"]+)"/gi;
const TABLE_REFERENCE_UNQUOTED = /Record\s+([A-Z][a-zA-Z0-9_]+)/g;

// Matches: Codeunit::"Name" or Page::"Name" etc.
const OBJECT_REFERENCE_PATTERN = /(Codeunit|Page|Report|Query|XMLport|Enum|Interface)\s*::\s*"?([^";\s,\)]+)"?/gi;

// Matches: Rec."Field Name" or SomeVar."Field Name"
const FIELD_REFERENCE_PATTERN = /\w+\."([^"]+)"/g;

export interface DependencyParseResult {
    fields: Omit<ALField, 'source'>[];
    extensions: Omit<ALExtension, 'source'>[];
    references: Omit<ALReference, 'source' | 'projectName'>[];
}

export function parseDependencies(content: string, filePath: string): DependencyParseResult {
    const lines = content.split('\n');
    const fields: Omit<ALField, 'source'>[] = [];
    const extensions: Omit<ALExtension, 'source'>[] = [];
    const references: Omit<ALReference, 'source' | 'projectName'>[] = [];

    let currentObjectName = '';
    let currentObjectType = '';

    // Track which references we've already found to avoid duplicates per file
    const seenTableRefs = new Set<string>();
    const seenObjectRefs = new Set<string>();
    const seenFieldRefs = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect object/extension declaration
        const objectPattern = /^\s*(codeunit|table|tableextension|page|pageextension|report|reportextension|xmlport|query|enum|enumextension|interface)\s+(\d+)\s+"?([^"{\n]+)"?/i;
        const objectMatch = line.match(objectPattern);
        if (objectMatch) {
            currentObjectType = objectMatch[1];
            currentObjectName = objectMatch[3].trim();
        }

        // Detect extension targets
        const extMatch = line.match(EXTENSION_PATTERN);
        if (extMatch) {
            extensions.push({
                extensionType: extMatch[1].toLowerCase() as ALExtension['extensionType'],
                extensionId: parseInt(extMatch[2], 10),
                extensionName: extMatch[3].trim(),
                targetObject: extMatch[4].trim(),
                filePath,
                line: i
            });
        }

        // Detect field declarations
        const fieldMatch = line.match(FIELD_PATTERN);
        if (fieldMatch && (currentObjectType.toLowerCase() === 'table' || currentObjectType.toLowerCase() === 'tableextension')) {
            fields.push({
                fieldName: fieldMatch[2].trim(),
                fieldId: parseInt(fieldMatch[1], 10),
                dataType: fieldMatch[3].trim(),
                objectName: currentObjectName,
                objectType: currentObjectType,
                filePath,
                line: i
            });
        }

        // Detect table references (Record "Table Name" or Record TableName)
        let tableRefMatch;
        const tableRefQuotedRegex = new RegExp(TABLE_REFERENCE_QUOTED.source, 'gi');
        while ((tableRefMatch = tableRefQuotedRegex.exec(line)) !== null) {
            const tableName = tableRefMatch[1];
            if (!seenTableRefs.has(tableName)) {
                seenTableRefs.add(tableName);
                references.push({
                    referenceType: 'table',
                    targetName: tableName,
                    context: line.trim(),
                    filePath,
                    line: i
                });
            }
        }
        // Unquoted Record references (e.g., Record CustomerTigOAC)
        const tableRefUnquotedRegex = new RegExp(TABLE_REFERENCE_UNQUOTED.source, 'g');
        let tableRefUnquoted;
        while ((tableRefUnquoted = tableRefUnquotedRegex.exec(line)) !== null) {
            const tableName = tableRefUnquoted[1];
            // Skip AL keywords that follow Record pattern
            if (['Record', 'Temporary', 'True', 'False', 'Integer', 'Code', 'Text', 'Boolean', 'Decimal', 'Date', 'Time', 'DateTime', 'Option', 'Blob', 'Guid', 'BigInteger', 'Duration'].includes(tableName)) { continue; }
            if (!seenTableRefs.has(tableName)) {
                seenTableRefs.add(tableName);
                references.push({
                    referenceType: 'table',
                    targetName: tableName,
                    context: line.trim(),
                    filePath,
                    line: i
                });
            }
        }

        // Detect object references (Codeunit::"Name", Page::"Name", etc.)
        let objRefMatch;
        const objRefRegex = new RegExp(OBJECT_REFERENCE_PATTERN.source, 'gi');
        while ((objRefMatch = objRefRegex.exec(line)) !== null) {
            const refType = objRefMatch[1].toLowerCase();
            const refName = objRefMatch[2].replace(/"/g, '').trim();
            const key = `${refType}::${refName}`;
            if (!seenObjectRefs.has(key)) {
                seenObjectRefs.add(key);
                references.push({
                    referenceType: refType as ALReference['referenceType'],
                    targetName: refName,
                    context: line.trim(),
                    filePath,
                    line: i
                });
            }
        }

        // Detect field references (Rec."Field Name")
        let fieldRefMatch;
        const fieldRefRegex = new RegExp(FIELD_REFERENCE_PATTERN.source, 'g');
        while ((fieldRefMatch = fieldRefRegex.exec(line)) !== null) {
            const fieldName = fieldRefMatch[1];
            if (!seenFieldRefs.has(fieldName)) {
                seenFieldRefs.add(fieldName);
                references.push({
                    referenceType: 'field',
                    targetName: fieldName,
                    context: line.trim(),
                    filePath,
                    line: i
                });
            }
        }
    }

    return { fields, extensions, references };
}
