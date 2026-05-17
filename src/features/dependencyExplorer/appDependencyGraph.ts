import * as vscode from 'vscode';
import * as path from 'path';

interface AppInfo {
    id: string;
    name: string;
    publisher: string;
    version: string;
    folderName: string;
    folderPath: string;
    dependencies: { id: string; name: string; publisher: string; version: string }[];
    isExternal?: boolean;  // true for Microsoft/third-party apps not in workspace
}

interface DependencyEdge {
    from: string;  // app name that depends
    to: string;    // app name it depends on
}

export class AppDependencyGraph {

    async buildGraph(): Promise<{ apps: AppInfo[]; edges: DependencyEdge[]; layers: string[][] } | undefined> {
        // Find all app.json files in workspace
        let appJsonFiles = await vscode.workspace.findFiles('**/app.json', '**/{.alpackages,node_modules}/**');

        // Also look in searchPaths for sibling extension app.json files
        const config = vscode.workspace.getConfiguration('alProductivityPack');
        const searchPaths = config.get<string[]>('searchPaths', []);
        for (const searchPath of searchPaths) {
            const pattern = new vscode.RelativePattern(searchPath, '**/app.json');
            const extraFiles = await vscode.workspace.findFiles(pattern);
            appJsonFiles = appJsonFiles.concat(extraFiles);
        }

        // Also try parent directory of workspace (common mono-repo pattern)
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const parentDir = path.dirname(workspaceRoot);
            // Check if parent has sibling projects with app.json
            const parentPattern = new vscode.RelativePattern(parentDir, '*/app.json');
            const siblingFiles = await vscode.workspace.findFiles(parentPattern);
            if (siblingFiles.length > 1) {
                // Deduplicate
                const existingPaths = new Set(appJsonFiles.map(f => f.fsPath));
                for (const f of siblingFiles) {
                    if (!existingPaths.has(f.fsPath)) {
                        appJsonFiles.push(f);
                    }
                }
            }
        }

        if (appJsonFiles.length === 0) {
            vscode.window.showInformationMessage('No app.json files found in the workspace.');
            return undefined;
        }

        // Deduplicate by file path
        const seen = new Set<string>();
        appJsonFiles = appJsonFiles.filter(f => {
            if (seen.has(f.fsPath)) { return false; }
            seen.add(f.fsPath);
            return true;
        });

        const apps: AppInfo[] = [];

        for (const file of appJsonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const content = JSON.parse(doc.getText());

                apps.push({
                    id: content.id || '',
                    name: content.name || '',
                    publisher: content.publisher || '',
                    version: content.version || '',
                    folderName: path.basename(path.dirname(file.fsPath)),
                    folderPath: path.dirname(file.fsPath),
                    dependencies: content.dependencies || []
                });
            } catch {
                // Skip invalid app.json
            }
        }

        // Build a map of app IDs to app names (only for apps in the workspace)
        const idToApp = new Map<string, AppInfo>();
        for (const app of apps) {
            idToApp.set(app.id.toLowerCase(), app);
        }

        // Find edges between local apps AND create external app nodes
        const edges: DependencyEdge[] = [];
        const externalApps = new Map<string, AppInfo>(); // id -> external app

        for (const app of apps) {
            for (const dep of app.dependencies) {
                const target = idToApp.get(dep.id.toLowerCase());
                if (target) {
                    edges.push({ from: app.name, to: target.name });
                } else {
                    // External dependency — create a placeholder node
                    if (!externalApps.has(dep.id.toLowerCase())) {
                        externalApps.set(dep.id.toLowerCase(), {
                            id: dep.id,
                            name: dep.name,
                            publisher: dep.publisher,
                            version: dep.version,
                            folderName: '',
                            folderPath: '',
                            dependencies: [],
                            isExternal: true
                        });
                    }
                    edges.push({ from: app.name, to: dep.name });
                }
            }
        }

        // Add external apps to the list
        const allApps = [...apps, ...externalApps.values()];

        // Topological sort to determine build layers (only for local apps)
        const layers = this.topologicalLayers(apps, edges.filter(e =>
            idToApp.has([...idToApp.values()].find(a => a.name === e.to)?.id.toLowerCase() || '')
        ));

        return { apps: allApps, edges, layers };
    }

    private topologicalLayers(apps: AppInfo[], edges: DependencyEdge[]): string[][] {
        // Build adjacency and in-degree
        const appNames = new Set(apps.map(a => a.name));
        const inDegree = new Map<string, number>();
        const dependents = new Map<string, string[]>(); // target -> [apps that depend on it]

        for (const name of appNames) {
            inDegree.set(name, 0);
            dependents.set(name, []);
        }

        for (const edge of edges) {
            inDegree.set(edge.from, (inDegree.get(edge.from) || 0) + 1);
            dependents.get(edge.to)!.push(edge.from);
        }

        // Kahn's algorithm — group by layers
        const layers: string[][] = [];
        const queue: string[] = [];

        for (const [name, degree] of inDegree) {
            if (degree === 0) {
                queue.push(name);
            }
        }

        while (queue.length > 0) {
            const layer = [...queue];
            layers.push(layer.sort());
            queue.length = 0;

            for (const name of layer) {
                for (const dependent of (dependents.get(name) || [])) {
                    const newDegree = (inDegree.get(dependent) || 1) - 1;
                    inDegree.set(dependent, newDegree);
                    if (newDegree === 0) {
                        queue.push(dependent);
                    }
                }
            }
        }

        // Any remaining (circular deps) go in last layer
        const placed = new Set(layers.flat());
        const remaining = [...appNames].filter(n => !placed.has(n));
        if (remaining.length > 0) {
            layers.push(remaining.sort());
        }

        return layers;
    }

    generateHtml(apps: AppInfo[], edges: DependencyEdge[], layers: string[][]): string {
        const appMap = new Map(apps.map(a => [a.name, a]));
        const localApps = apps.filter(a => !a.isExternal);
        const externalApps = apps.filter(a => a.isExternal);

        // Group external apps by publisher
        const externalByPublisher = new Map<string, AppInfo[]>();
        for (const app of externalApps) {
            const existing = externalByPublisher.get(app.publisher) || [];
            existing.push(app);
            externalByPublisher.set(app.publisher, existing);
        }

        // Build deploy sequence — numbered list
        let step = 1;
        const sequenceHtml = layers.map((layer, _layerIdx) => {
            const items = layer.map(name => {
                const app = appMap.get(name);
                if (!app) { return ''; }
                const dependentCount = edges.filter(e => e.to === name && !appMap.get(e.from)?.isExternal).length;
                const localDeps = edges.filter(e => e.from === name && appMap.get(e.to) && !appMap.get(e.to)!.isExternal);
                const externalDeps = edges.filter(e => e.from === name && appMap.get(e.to)?.isExternal);

                let depInfo = '';
                if (localDeps.length > 0) {
                    depInfo = `<span class="dep-arrow">← needs: ${localDeps.map(e => e.to).join(', ')}</span>`;
                }

                let extInfo = '';
                if (externalDeps.length > 0) {
                    extInfo = `<span class="ext-info">+ ${externalDeps.length} external (${[...new Set(externalDeps.map(e => appMap.get(e.to)?.publisher || ''))].join(', ')})</span>`;
                }

                const html = `<div class="deploy-item" data-folder="${app.folderPath}">
                    <div class="step-number">${step}</div>
                    <div class="step-content">
                        <div class="step-name">${name}</div>
                        <div class="step-meta">${app.publisher} · v${app.version} · 📁 ${app.folderName}</div>
                        ${depInfo}
                        ${extInfo}
                        ${dependentCount > 0 ? `<span class="step-dependents">${dependentCount} app${dependentCount > 1 ? 's' : ''} depend on this</span>` : ''}
                    </div>
                </div>`;
                step++;
                return html;
            }).join('');

            const canParallel = layer.length > 1 ? `<div class="parallel-note">↕ These ${layer.length} can be deployed in parallel</div>` : '';

            return `${canParallel}${items}`;
        }).join('');

        // External section
        let externalHtml = '';
        if (externalApps.length > 0) {
            const publisherGroups = [...externalByPublisher.entries()]
                .sort((a, b) => b[1].length - a[1].length)
                .map(([publisher, pubApps]) => {
                    const appList = pubApps.sort((a, b) => a.name.localeCompare(b.name)).map(app => {
                        const usedBy = edges.filter(e => e.to === app.name && !appMap.get(e.from)?.isExternal);
                        return `<div class="ext-item">
                            <span class="ext-name">${app.name}</span>
                            <span class="ext-version">v${app.version}</span>
                            ${usedBy.length > 0 ? `<span class="ext-used-by">← ${usedBy.map(e => e.from).join(', ')}</span>` : ''}
                        </div>`;
                    }).join('');

                    return `<div class="publisher-group">
                        <div class="publisher-label">${publisher} (${pubApps.length})</div>
                        ${appList}
                    </div>`;
                }).join('');

            externalHtml = `<div class="section">
                <h3>📦 External Dependencies (deploy these first)</h3>
                <p class="hint">These must be installed before your local apps.</p>
                ${publisherGroups}
            </div>`;
        }

        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); max-width: 800px; }
        h2 { color: var(--vscode-textLink-foreground); margin-bottom: 4px; }
        h3 { color: var(--vscode-textLink-foreground); margin-bottom: 8px; font-size: 14px; }
        .summary { margin-bottom: 24px; font-size: 13px; opacity: 0.8; }
        .hint { font-size: 12px; opacity: 0.6; margin-top: -4px; margin-bottom: 12px; }

        .deploy-item { display: flex; align-items: flex-start; padding: 12px 16px; margin: 6px 0; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; cursor: pointer; transition: all 0.15s; }
        .deploy-item:hover { border-color: var(--vscode-textLink-foreground); background: var(--vscode-list-hoverBackground); transform: translateX(4px); }
        .step-number { width: 32px; height: 32px; border-radius: 50%; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; margin-right: 14px; flex-shrink: 0; }
        .step-content { flex: 1; }
        .step-name { font-weight: bold; font-size: 14px; }
        .step-meta { font-size: 11px; opacity: 0.6; margin-top: 2px; }
        .dep-arrow { display: block; font-size: 11px; color: var(--vscode-charts-blue); margin-top: 4px; }
        .ext-info { display: block; font-size: 11px; color: var(--vscode-charts-yellow); margin-top: 2px; }
        .step-dependents { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 8px; background: var(--vscode-charts-green); color: #fff; margin-top: 4px; }

        .parallel-note { text-align: center; font-size: 11px; opacity: 0.6; padding: 8px; margin: 4px 0; border: 1px dashed var(--vscode-panel-border); border-radius: 4px; }

        .section { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); }
        .publisher-group { margin: 12px 0; }
        .publisher-label { font-size: 12px; font-weight: bold; opacity: 0.7; margin-bottom: 6px; }
        .ext-item { padding: 6px 12px; margin: 3px 0; border-radius: 4px; background: var(--vscode-textBlockQuote-background); border: 1px dashed var(--vscode-panel-border); font-size: 12px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .ext-name { font-weight: 500; }
        .ext-version { opacity: 0.5; font-size: 11px; }
        .ext-used-by { font-size: 10px; opacity: 0.6; font-style: italic; }
    </style>
</head>
<body>
    <h2>🚀 Deploy Sequence</h2>
    <div class="summary">
        ${localApps.length} local apps · ${externalApps.length} external · Click any app to open its folder
    </div>

    ${sequenceHtml}

    ${externalHtml}

    <script>
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('.deploy-item').forEach(item => {
            item.addEventListener('click', () => {
                const folder = item.getAttribute('data-folder');
                if (folder) {
                    vscode.postMessage({ command: 'openApp', folder });
                }
            });
        });
    </script>
</body>
</html>`;
    }
}
