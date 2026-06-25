import * as vscode from 'vscode';
import { runMinimalDataverseWizard, scanBCTableFields, detectTargetPage } from './wizardFlow';
import { runAltpgen } from './altpgenExecutor';
import { showFieldMappingWebview } from './fieldMappingView';
import { generateCouplingCodeunit, generateListPage, generatePageExtension } from './codeGenerator';
import { parseAltpgenOutput } from './altpgenParser';

export async function generateDataverseIntegrationCommand(): Promise<void> {
    try {
        // Run the minimal wizard to collect configuration
        const config = await runMinimalDataverseWizard();
        if (!config) {
            vscode.window.showInformationMessage('ALP Dataverse wizard cancelled.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open. Please open an AL project.');
            return;
        }

        const rootUri = workspaceFolders[0].uri;
        const outputUri = vscode.Uri.joinPath(rootUri, 'src', 'DataverseIntegration');

        // Use a status bar item for non-blocking progress
        const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusItem.name = 'ALP Dataverse';

        const setStatus = (text: string) => {
            statusItem.text = `$(sync~spin) ALP: ${text}`;
            statusItem.show();
        };

        try {
            setStatus('Running altpgen.exe...');
            const altpgenResult = await runAltpgen(
                config.dataverseUrl,
                config.clientId,
                config.redirectUri,
                config.dataverseEntityName,
                config.nextObjectId
            );

            if (!altpgenResult.success) {
                throw new Error(`altpgen.exe failed: ${altpgenResult.error}`);
            }

            setStatus('Parsing generated table...');
            const dvTable = await parseAltpgenOutput(config.dataverseEntityName);
            if (!dvTable) {
                throw new Error(`Could not find the altpgen-generated table for entity '${config.dataverseEntityName}'. Make sure altpgen completed successfully.`);
            }

            setStatus('Fetching BC table fields...');
            const bcFields = await scanBCTableFields(config.bcTableName);
            const dvFields = dvTable.fields.map(f => f.name);

            setStatus('Waiting for field mapping...');
            const fieldMappings = await showFieldMappingWebview(bcFields, dvFields);

            setStatus('Detecting target page...');
            const targetPage = await detectTargetPage(config.bcTableName);
            if (targetPage) {
                config.bcCardPageName = targetPage;
            }

            setStatus('Generating AL files...');
            const listPageCode = generateListPage(config, dvTable);
            const codeunitCode = generateCouplingCodeunit(config, dvTable, fieldMappings);
            const pageExtCode = generatePageExtension(config);

            await vscode.workspace.fs.createDirectory(outputUri);

            const sanitizedTableName = config.bcTableName.replace(/\s+/g, '');
            const sanitizedDvTableName = dvTable.tableName.replace(/\s+/g, '');

            const files: { name: string; content: string; description: string }[] = [
                {
                    name: `Pag${config.nextObjectId}.${sanitizedDvTableName}List.al`,
                    content: listPageCode,
                    description: 'List Page'
                },
                {
                    name: `Cod${config.nextObjectId + 1}.${sanitizedTableName}DVInteg.al`,
                    content: codeunitCode,
                    description: 'Integration Codeunit'
                }
            ];

            if (pageExtCode) {
                files.push({
                    name: `PagExt${config.nextObjectId + 2}.${sanitizedTableName}DVSynch.al`,
                    content: pageExtCode,
                    description: 'Page Extension'
                });
            }

            const createdFiles: vscode.Uri[] = [];
            for (const file of files) {
                const fileUri = vscode.Uri.joinPath(outputUri, file.name);
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, 'utf8'));
                createdFiles.push(fileUri);
            }

            statusItem.text = `$(check) ALP: ${files.length} files generated`;
            setTimeout(() => statusItem.dispose(), 5000);

            const action = await vscode.window.showInformationMessage(
                `ALP Dataverse integration generated. ${files.length} files created for ${config.bcTableName} ↔ ${config.dataverseEntityName}.`,
                'Open Files'
            );

            if (action === 'Open Files') {
                for (const uri of createdFiles) {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
            }
        } finally {
            // Ensure status bar cleans up if an error occurs
            if (statusItem.text.includes('sync~spin')) {
                statusItem.dispose();
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`ALP Dataverse integration failed: ${message}`);
        throw error;
    }
}
