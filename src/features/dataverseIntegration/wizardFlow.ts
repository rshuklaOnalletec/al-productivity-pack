import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Token cache — persists for the VS Code session
let cachedToken: { token: string; expiresAt: number; serviceUrl: string } | undefined;

/**
 * Get a cached token or acquire a new one. Informs the user when reusing cache.
 */
export async function getDataverseToken(serviceUrl: string, clientId: string, silent: boolean = false): Promise<string | undefined> {
    if (cachedToken && cachedToken.serviceUrl === serviceUrl && Date.now() < cachedToken.expiresAt) {
        if (!silent) {
            vscode.window.showInformationMessage('Using cached Dataverse credentials.');
        }
        return cachedToken.token;
    }

    const token = await acquireDataverseToken(serviceUrl, clientId);
    if (token) {
        // Cache for 50 minutes (tokens typically valid for 60–90 min)
        cachedToken = { token, expiresAt: Date.now() + 50 * 60 * 1000, serviceUrl };
    }
    return token;
}

/**
 * Clear the cached token.
 */
export function clearDataverseTokenCache(): void {
    cachedToken = undefined;
    vscode.window.showInformationMessage('Dataverse credential cache cleared.');
}

/**
 * POST request helper for OAuth token endpoints.
 */
function httpPost(url: string, body: string, contentType: string = 'application/x-www-form-urlencoded'): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': contentType,
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

export function httpGet(url: string, bearerToken: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Accept': 'application/json',
                'OData-MaxVersion': '4.0',
                'OData-Version': '4.0'
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Acquire an access token for Dataverse using OAuth2 Device Code Flow.
 * Uses the user's configured clientId.
 */
export async function acquireDataverseToken(serviceUrl: string, clientId: string): Promise<string | undefined> {
    // Ensure no trailing slash on URL for scope
    const cleanUrl = serviceUrl.replace(/\/+$/, '');
    const scope = `${cleanUrl}/user_impersonation offline_access`;
    const deviceCodeUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode';
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    // Step 1: Request device code
    const dcBody = `client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scope)}`;
    let dcResponse: any;
    try {
        dcResponse = JSON.parse(await httpPost(deviceCodeUrl, dcBody));
    } catch (e: any) {
        vscode.window.showErrorMessage(`Device code request failed: ${e?.message || e}`);
        return undefined;
    }

    if (!dcResponse.device_code || !dcResponse.user_code) {
        vscode.window.showErrorMessage(`Device code error: ${dcResponse.error_description || JSON.stringify(dcResponse)}`);
        return undefined;
    }

    // Step 2: Show user the code and open browser
    const userCode: string = dcResponse.user_code;
    const verificationUri: string = dcResponse.verification_uri || 'https://microsoft.com/devicelogin';
    const interval = (dcResponse.interval || 5) * 1000;
    const expiresIn = (dcResponse.expires_in || 900) * 1000;

    const action = await vscode.window.showInformationMessage(
        `Sign in to Dataverse: Enter code **${userCode}** at the device login page.`,
        { modal: true },
        'Open Browser & Copy Code'
    );

    if (!action) { return undefined; }

    await vscode.env.clipboard.writeText(userCode);
    await vscode.env.openExternal(vscode.Uri.parse(verificationUri));

    // Step 3: Poll for token
    const pollBody = `grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=${encodeURIComponent(clientId)}&device_code=${encodeURIComponent(dcResponse.device_code)}`;
    const deadline = Date.now() + expiresIn;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, interval));
        try {
            const tokenResponse = JSON.parse(await httpPost(tokenUrl, pollBody));
            if (tokenResponse.access_token) {
                return tokenResponse.access_token;
            }
            if (tokenResponse.error === 'authorization_pending') {
                continue;
            }
            // expired or declined
            return undefined;
        } catch {
            continue;
        }
    }
    return undefined;
}

/**
 * Fetch entity list from the Dataverse Web API using device code auth.
 */
async function fetchDataverseEntities(serviceUrl: string, clientId: string): Promise<vscode.QuickPickItem[]> {
    try {
        const token = await getDataverseToken(serviceUrl, clientId);
        if (!token) { return []; }

        const cleanUrl = serviceUrl.replace(/\/+$/, '');
        const apiUrl = `${cleanUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,SchemaName,IsCustomEntity`;

        const body = await httpGet(apiUrl, token);
        const data = JSON.parse(body);

        const items: vscode.QuickPickItem[] = [];
        for (const entity of data.value || []) {
            const logicalName: string = entity.LogicalName || '';
            const schemaName: string = entity.SchemaName || '';
            items.push({
                label: logicalName,
                description: schemaName !== logicalName ? schemaName : (entity.IsCustomEntity ? 'Custom' : '')
            });
        }
        items.sort((a, b) => a.label.localeCompare(b.label));
        return items;
    } catch (e: any) {
        const msg = e?.message || String(e);
        vscode.window.showErrorMessage(`Dataverse API error: ${msg}`);
        return [];
    }
}

/**
 * Fetch attribute (field) names for a specific Dataverse entity.
 */
export async function fetchDataverseEntityFields(serviceUrl: string, clientId: string, entityLogicalName: string): Promise<string[]> {
    try {
        const token = await getDataverseToken(serviceUrl, clientId, true);
        if (!token) { return []; }

        const cleanUrl = serviceUrl.replace(/\/+$/, '');
        const apiUrl = `${cleanUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes?$select=LogicalName,AttributeType`;

        const body = await httpGet(apiUrl, token);
        const data = JSON.parse(body);

        const fields: string[] = [];
        for (const attr of data.value || []) {
            if (attr.LogicalName && attr.AttributeType !== 'Virtual') {
                fields.push(attr.LogicalName);
            }
        }
        fields.sort();
        return fields;
    } catch {
        return [];
    }
}

/**
 * Scan workspace .al files for fields in a specific BC table.
 */
export async function scanBCTableFields(tableName: string): Promise<string[]> {
    const fields: string[] = [];
    try {
        const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,.alp-altpgen-temp,node_modules}/**');
        const tablePattern = new RegExp(`^\\s*table\\s+\\d+\\s+"?${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, 'im');
        const fieldPattern = /^\s*field\(\s*\d+\s*;\s*"?([^"\);]+)"?\s*;/gm;

        for (const file of alFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                if (tablePattern.test(text)) {
                    let match;
                    while ((match = fieldPattern.exec(text)) !== null) {
                        fields.push(match[1].trim());
                    }
                    break;
                }
            } catch { /* skip */ }
        }
    } catch { /* ignore */ }
    fields.sort();
    return fields;
}

/**
 * Scan workspace .al files for table object definitions.
 */
async function scanBCTables(): Promise<vscode.QuickPickItem[]> {
    const items: vscode.QuickPickItem[] = [];
    try {
        const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,.alp-altpgen-temp,node_modules}/**');
        const tablePattern = /^\s*table\s+(\d+)\s+"?([^"\r\n{]+)"?/im;

        for (const file of alFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const match = doc.getText().match(tablePattern);
                if (match) {
                    items.push({
                        label: match[2].trim(),
                        description: `ID ${match[1]}`
                    });
                }
            } catch { /* skip */ }
        }
    } catch { /* ignore */ }

    items.sort((a, b) => a.label.localeCompare(b.label));
    items.push({ label: '$(edit) Enter custom table name...', description: '', alwaysShow: true });
    return items;
}

/**
 * Auto-detect the target page for extending (Card or List).
 * Looks at table's LookupPageId → that page's CardPageId.
 */
export async function detectTargetPage(bcTableName: string): Promise<string | undefined> {
    try {
        const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,.alp-altpgen-temp,node_modules}/**');

        // Step 1: Find the table and get its LookupPageId
        const tablePattern = new RegExp(`^\\s*table\\s+\\d+\\s+"?${bcTableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, 'im');
        let lookupPageName: string | undefined;

        for (const file of alFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                if (tablePattern.test(text)) {
                    const lookupMatch = text.match(/LookupPageId\s*=\s*"?([^";]+)"?\s*;/i);
                    if (lookupMatch) {
                        lookupPageName = lookupMatch[1].trim();
                    }
                    const drillMatch = text.match(/DrillDownPageId\s*=\s*"?([^";]+)"?\s*;/i);
                    if (!lookupPageName && drillMatch) {
                        lookupPageName = drillMatch[1].trim();
                    }
                    break;
                }
            } catch { /* skip */ }
        }

        if (!lookupPageName) { return undefined; }

        // Step 2: Find that page and check for CardPageId
        const pagePattern = new RegExp(`^\\s*page\\s+\\d+\\s+"?${lookupPageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, 'im');

        for (const file of alFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                if (pagePattern.test(text)) {
                    const cardMatch = text.match(/CardPageId\s*=\s*"?([^";]+)"?\s*;/i);
                    if (cardMatch) {
                        return cardMatch[1].trim(); // Use the Card page
                    }
                    return lookupPageName; // No card page, extend the list page
                }
            } catch { /* skip */ }
        }

        // Page file not found in workspace — might be in base app symbols
        // Return the lookup page name as best guess
        return lookupPageName;
    } catch {
        return undefined;
    }
}

export interface DataverseConfig {
    // Minimal config - only essentials
    dataverseEntityName: string;        // e.g. "cdm_worker"
    bcTableName: string;                // e.g. "Employee"
    bcCardPageName?: string;            // e.g. "Employee Card" — for page extension
    dataverseUrl: string;               // e.g. "https://org.crm.dynamics.com"
    clientId?: string;
    redirectUri?: string;
    
    // Auto-detected
    nextObjectId: number;
}

/**
 * Single-screen webview wizard for Dataverse integration configuration.
 */
export async function runMinimalDataverseWizard(): Promise<DataverseConfig | undefined> {
    const config = vscode.workspace.getConfiguration('alProductivityPack');
    const dvDefaults = {
        serviceUrl: config.get<string>('dataverse.serviceUrl', '').trim(),
        clientId: config.get<string>('dataverse.clientId', '').trim(),
        redirectUri: config.get<string>('dataverse.redirectUri', '').trim()
    };

    if (!dvDefaults.serviceUrl || !dvDefaults.clientId) {
        const action = await vscode.window.showWarningMessage(
            'Dataverse defaults are incomplete. Please set service URL and client ID in AL Productivity Pack settings.',
            { modal: true },
            'Open Settings'
        );
        if (action === 'Open Settings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'alProductivityPack.dataverse');
        }
        return undefined;
    }

    // Authenticate first — this may trigger device code flow if no cached token
    const token = await getDataverseToken(dvDefaults.serviceUrl, dvDefaults.clientId);
    if (!token) {
        vscode.window.showErrorMessage('Dataverse authentication failed. Cannot load entities.');
        return undefined;
    }

    // Now gather data in parallel — token is cached so entity fetch is just an API call
    const [entities, bcTables, nextObjectId] = await Promise.all([
        fetchDataverseEntities(dvDefaults.serviceUrl, dvDefaults.clientId),
        scanBCTables(),
        detectNextObjectId()
    ]);

    const entityOptions = entities.map(e => ({ label: e.label, description: e.description || '' }));
    const bcTableOptions = bcTables
        .filter(t => !t.label.includes('Enter custom'))
        .map(t => ({ label: t.label, description: t.description || '' }));

    return new Promise<DataverseConfig | undefined>((resolve) => {
        const panel = vscode.window.createWebviewPanel(
            'dataverseWizard',
            'Dataverse Integration Wizard',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        panel.webview.html = getWizardHtml(entityOptions, bcTableOptions, nextObjectId, dvDefaults.serviceUrl);

        panel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'generate') {
                resolve({
                    dataverseEntityName: message.entityName,
                    bcTableName: message.bcTableName,
                    dataverseUrl: dvDefaults.serviceUrl,
                    clientId: dvDefaults.clientId || undefined,
                    redirectUri: dvDefaults.redirectUri || undefined,
                    nextObjectId: parseInt(message.baseId, 10) || nextObjectId
                });
                panel.dispose();
            } else if (message.command === 'cancel') {
                resolve(undefined);
                panel.dispose();
            }
        });

        panel.onDidDispose(() => resolve(undefined));
    });
}

function getWizardHtml(
    entities: { label: string; description: string }[],
    bcTables: { label: string; description: string }[],
    nextObjectId: number,
    serviceUrl: string
): string {
    const entityOptionsHtml = entities.map(e =>
        `<option value="${e.label}">${e.label}${e.description ? ' — ' + e.description : ''}</option>`
    ).join('\n');

    const bcTableOptionsHtml = bcTables.map(t =>
        `<option value="${t.label}">${t.label}${t.description ? ' (' + t.description + ')' : ''}</option>`
    ).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dataverse Integration Wizard</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); max-width: 700px; margin: 0 auto; }
        h1 { font-size: 1.4em; margin-bottom: 4px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; font-size: 0.9em; }
        .form-group { margin-bottom: 16px; }
        label { display: block; margin-bottom: 4px; font-weight: bold; font-size: 0.9em; }
        .hint { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-bottom: 4px; }
        input, select { width: 100%; padding: 8px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; font-size: 0.9em; }
        select { appearance: auto; }
        .row { display: flex; gap: 16px; }
        .row .form-group { flex: 1; }
        .buttons { margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end; }
        button { padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .info-bar { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); padding: 10px 14px; border-radius: 4px; margin-bottom: 20px; font-size: 0.85em; }
        .info-bar code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>Dataverse Integration Generator</h1>
    <p class="subtitle">Configure all settings below and click Generate.</p>

    <div class="info-bar">
        Connected to: <code>${serviceUrl}</code>
        ${entities.length > 0 ? ` · ${entities.length} entities loaded` : ' · <em>No entities loaded (check auth)</em>'}
    </div>

    <div class="form-group">
        <label for="entityName">Dataverse Entity</label>
        <div class="hint">The logical name of the Dataverse entity to integrate</div>
        ${entities.length > 0
            ? `<input id="entityName" list="entityList" placeholder="Type to search or select..." />
               <datalist id="entityList">${entityOptionsHtml}</datalist>`
            : `<input id="entityName" placeholder="e.g. position, cdm_worker, contact" />`
        }
    </div>

    <div class="form-group">
        <label for="bcTableName">Business Central Table</label>
        <div class="hint">The BC table to couple with the Dataverse entity</div>
        ${bcTables.length > 0
            ? `<input id="bcTableName" list="bcTableList" placeholder="Type to search or select..." />
               <datalist id="bcTableList">${bcTableOptionsHtml}</datalist>`
            : `<input id="bcTableName" placeholder="e.g. Employee, Customer" />`
        }
    </div>

    <div class="form-group">
        <label for="baseId">Base Object ID</label>
        <div class="hint">Starting ID for generated objects (auto-detected from workspace)</div>
        <input id="baseId" type="number" value="${nextObjectId}" style="max-width: 200px;" />
    </div>

    <div class="buttons">
        <button class="btn-secondary" onclick="cancel()">Cancel</button>
        <button class="btn-primary" onclick="generate()">Generate Integration</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function generate() {
            const entityName = document.getElementById('entityName').value.trim();
            const bcTableName = document.getElementById('bcTableName').value.trim();
            const baseId = document.getElementById('baseId').value.trim();

            if (!entityName) { alert('Please select or enter a Dataverse entity name.'); return; }
            if (!bcTableName) { alert('Please select or enter a BC table name.'); return; }

            vscode.postMessage({ command: 'generate', entityName, bcTableName, baseId });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        // Allow Enter key to submit
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { generate(); }
        });
    </script>
</body>
</html>`;
}

/**
 * Scan project for highest object ID and return next available.
 */
async function detectNextObjectId(): Promise<number> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return 50100; // Default fallback
    }

    try {
        const alFiles = await vscode.workspace.findFiles('**/*.al', '**/{.alpackages,node_modules}/**');
        let maxId = 50000;

        // Regex to find object declarations: "codeunit 50100", "page 50200", "table 50300", etc.
        const objectPattern = /^\s*(codeunit|table|page|report|query|enum|interface|tableextension|pageextension|enumextension|reportextension)\s+(\d+)/im;

        for (const file of alFiles) {
            try {
                const content = await vscode.workspace.openTextDocument(file);
                const text = content.getText();
                const lines = text.split('\n');
                
                for (const line of lines) {
                    const match = line.match(objectPattern);
                    if (match) {
                        const id = parseInt(match[2], 10);
                        if (id > maxId) {
                            maxId = id;
                        }
                    }
                }
            } catch {
                // Skip files that can't be read
            }
        }

        return maxId + 1;
    } catch {
        return 50100;
    }
}

export async function getAltpgenPath(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('alProductivityPack');
    const configuredPath = config.get<string>('dataverse.altpgenPath', '').trim();
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }

    // Try common VS Code AL extension paths on Windows
    const userHome = process.env.USERPROFILE || process.env.HOME;
    if (!userHome) { return undefined; }

    const possiblePaths = [
        path.join(userHome, '.vscode/extensions'),
        path.join(userHome, '.vscode-insiders/extensions')
    ];

    for (const basePath of possiblePaths) {
        try {
            if (!fs.existsSync(basePath)) {
                continue;
            }

            const folders = fs.readdirSync(basePath, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name)
                .filter(name =>
                    name.startsWith('ms-dynamics-smb.al') ||
                    name.startsWith('microsoft.al')
                );

            for (const folder of folders) {
                const candidatePaths = [
                    path.join(basePath, folder, 'bin', 'altpgen.exe'),
                    path.join(basePath, folder, 'bin', 'win32', 'altpgen', 'altpgen.exe')
                ];

                for (const altpgenPath of candidatePaths) {
                    if (fs.existsSync(altpgenPath)) {
                        return altpgenPath;
                    }
                }
            }
        } catch {
            // Continue searching
        }
    }

    return undefined;
}
