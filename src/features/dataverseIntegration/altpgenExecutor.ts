import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getAltpgenPath } from './wizardFlow';

export interface AltpgenResult {
    success: boolean;
    generatedTablePath?: string;
    tableContent?: string;
    error?: string;
}

/**
 * Execute altpgen.exe to generate the integration table.
 */
export async function runAltpgen(
    dataverseUrl: string,
    clientId: string | undefined,
    redirectUri: string | undefined,
    entityName: string,
    baseId: number
): Promise<AltpgenResult> {
    if (!clientId || !clientId.trim()) {
        return {
            success: false,
            error: 'Dataverse client ID is required. Set alProductivityPack.dataverse.clientId in settings.'
        };
    }

    const effectiveRedirectUri = (redirectUri && redirectUri.trim()) ? redirectUri.trim() : '';

    let altpgenPath = await getAltpgenPath();
    if (!altpgenPath) {
        const choice = await vscode.window.showErrorMessage(
            'altpgen.exe not found. Configure it in settings or locate the file now.',
            'Locate altpgen.exe',
            'Open Settings'
        );

        if (choice === 'Open Settings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'alProductivityPack.dataverse.altpgenPath');
            return {
                success: false,
                error: 'altpgen.exe path not configured yet.'
            };
        }

        if (choice === 'Locate altpgen.exe') {
            const selected = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFolders: false,
                canSelectFiles: true,
                filters: { Executable: ['exe'] },
                openLabel: 'Use this altpgen.exe'
            });

            if (!selected || selected.length === 0) {
                return {
                    success: false,
                    error: 'altpgen.exe was not selected.'
                };
            }

            altpgenPath = selected[0].fsPath;
            const config = vscode.workspace.getConfiguration('alProductivityPack');
            await config.update('dataverse.altpgenPath', altpgenPath, vscode.ConfigurationTarget.Workspace);
        }

        if (!altpgenPath) {
            return {
                success: false,
                error: 'altpgen.exe not found. Please ensure the AL extension is installed or set alProductivityPack.dataverse.altpgenPath.'
            };
        }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return {
            success: false,
            error: 'No workspace folder open.'
        };
    }

    const projectFolder = workspaceFolders[0].uri.fsPath;
    const alConfig = vscode.workspace.getConfiguration('al');
    const rawPackageCache = alConfig.get('packageCachePath', '');
    const configuredPackageCache = (typeof rawPackageCache === 'string' ? rawPackageCache : '').trim();
    const localPackageCache = path.join(projectFolder, '.alpackages');

    let cacheFolder = configuredPackageCache || localPackageCache;

    if (!fs.existsSync(cacheFolder)) {
        if (configuredPackageCache && fs.existsSync(localPackageCache)) {
            cacheFolder = localPackageCache;
        } else {
            const choice = await vscode.window.showWarningMessage(
                `AL package cache path not found: ${cacheFolder}`,
                'Locate package cache folder',
                'Continue anyway'
            );

            if (choice === 'Locate package cache folder') {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    canSelectFiles: false,
                    canSelectFolders: true,
                    openLabel: 'Use this package cache folder'
                });

                if (!picked || picked.length === 0) {
                    return {
                        success: false,
                        error: 'Package cache folder not selected.'
                    };
                }

                cacheFolder = picked[0].fsPath;
            }
        }
    }

    // Build altpgen arguments
    const args = [
        `-project:${projectFolder}`,
        `-packagecachepath:${cacheFolder}`,
        `-serviceuri:${dataverseUrl}`,
        `-clientid:${clientId.trim()}`,
        ...(effectiveRedirectUri ? [`-redirecturi:${effectiveRedirectUri}`] : []),
        `-entities:${entityName}`,
        `-baseid:${baseId}`
    ];

    // Run altpgen as a child process, stream output to an Output Channel
    const outputChannel = vscode.window.createOutputChannel('ALP Dataverse (altpgen)');
    outputChannel.show(true);
    outputChannel.appendLine(`Running: ${altpgenPath}`);
    outputChannel.appendLine(`Args: ${args.join(' ')}`);
    outputChannel.appendLine('---');

    return new Promise<AltpgenResult>((resolve) => {
        const proc = spawn(altpgenPath!, args, { cwd: projectFolder });

        proc.stdout.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        proc.stderr.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        proc.on('error', (err) => {
            outputChannel.appendLine(`\n--- Process error: ${err.message} ---`);
            resolve({
                success: false,
                error: `Failed to start altpgen.exe: ${err.message}`
            });
        });

        proc.on('close', (code) => {
            if (code === 0) {
                outputChannel.appendLine('\n--- altpgen completed successfully ---');
                resolve({ success: true });
            } else {
                outputChannel.appendLine(`\n--- altpgen exited with code ${code} ---`);
                resolve({
                    success: false,
                    error: `altpgen.exe exited with code ${code}. Check the "ALP Dataverse (altpgen)" output channel for details.`
                });
            }
        });
    });
}
