import { DataverseConfig } from './wizardFlow';
import { FieldPairing } from './fieldMappingView';
import { AltpgenTableInfo } from './altpgenParser';

export interface GeneratedAlCode {
    listPageCode: string;
    codeunitCode: string;
    pageExtensionCode: string;
}

/** Quote a field/object name for AL if it contains non-alphanumeric chars */
function alQuote(name: string): string {
    return /^[a-zA-Z][a-zA-Z0-9]*$/.test(name) ? name : `"${name}"`;
}

/** Truncate a name to max chars for AL object identifiers */
function truncateName(name: string, maxLen: number): string {
    return name.length > maxLen ? name.substring(0, maxLen) : name;
}

/** Create a mapping name that fits Code[20] */
function makeMappingName(bcTableName: string, entityName: string): string {
    const bc = bcTableName.toUpperCase().replace(/\s+/g, '').substring(0, 8);
    const dv = entityName.toUpperCase().replace(/^CDM_/, '').substring(0, 10);
    return `${bc}-${dv}`.substring(0, 20);
}

/**
 * Generate AL code for the integration table mapping codeunit.
 */
export function generateCouplingCodeunit(
    config: DataverseConfig,
    dvTable: AltpgenTableInfo,
    fieldMappings: FieldPairing[]
): string {
    const codeunitId = config.nextObjectId + 1;
    const dvTableName = dvTable.tableName;
    const dvTableSafe = sanitizeIdentifier(dvTableName);
    const codeunitName = truncateName(`${config.bcTableName} DV Integ`, 30);
    const mappingName = makeMappingName(config.bcTableName, config.dataverseEntityName);

    const fieldMappingCode = fieldMappings.length > 0
        ? fieldMappings.map((fm: FieldPairing) => {
            const dvField = dvTable.fields.find(f => f.name === fm.dataverseFieldName || f.externalName === fm.dataverseFieldName);
            const direction = fm.direction === 'Bidirectional' ? 'IntegrationFieldMapping.Direction::Bidirectional'
                : fm.direction === 'FromBC' ? 'IntegrationFieldMapping.Direction::ToIntegrationTable'
                : 'IntegrationFieldMapping.Direction::FromIntegrationTable';
            return `        InsertIntegrationFieldMapping('${mappingName}',\n` +
                   `            BCRec.FieldNo(${alQuote(fm.bcFieldName)}),\n` +
                   `            DataverseRec.FieldNo(${alQuote(dvField ? dvField.name : fm.dataverseFieldName)}),\n` +
                   `            ${direction}, '', true, false);`;
        }).join('\n')
        : `        // TODO: Add field mappings using InsertIntegrationFieldMapping`;

    return `codeunit ${codeunitId} "${codeunitName}"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CRM Setup Defaults", 'OnGetCDSTableNo', '', false, false)]
    local procedure HandleOnGetCDSTableNo(BCTableNo: Integer; var CDSTableNo: Integer; var handled: Boolean)
    begin
        if BCTableNo = Database::"${config.bcTableName}" then begin
            CDSTableNo := Database::"${dvTableName}";
            handled := true;
        end;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Lookup CRM Tables", 'OnLookupCRMTables', '', false, false)]
    local procedure HandleOnLookupCRMTables(CRMTableID: Integer; NAVTableId: Integer; SavedCRMId: Guid; var CRMId: Guid; IntTableFilter: Text; var Handled: Boolean)
    begin
        if CRMTableID = Database::"${dvTableName}" then
            Handled := Lookup${dvTableSafe}(SavedCRMId, CRMId, IntTableFilter);
    end;

    local procedure Lookup${dvTableSafe}(SavedCRMId: Guid; var CRMId: Guid; IntTableFilter: Text): Boolean
    var
        ${dvTableSafe}: Record "${dvTableName}";
        Original${dvTableSafe}: Record "${dvTableName}";
        ${dvTableSafe}List: Page "${dvTableName} List";
    begin
        if not IsNullGuid(CRMId) then begin
            if ${dvTableSafe}.Get(CRMId) then
                ${dvTableSafe}List.SetRecord(${dvTableSafe});
            if not IsNullGuid(SavedCRMId) then
                if Original${dvTableSafe}.Get(SavedCRMId) then
                    ${dvTableSafe}List.SetCurrentlyCoupled${dvTableSafe}(Original${dvTableSafe});
        end;

        ${dvTableSafe}.SetView(IntTableFilter);
        ${dvTableSafe}List.SetTableView(${dvTableSafe});
        ${dvTableSafe}List.LookupMode(true);
        if ${dvTableSafe}List.RunModal() = ACTION::LookupOK then begin
            ${dvTableSafe}List.GetRecord(${dvTableSafe});
            CRMId := ${dvTableSafe}.${alQuote(dvTable.primaryKeyField)};
            exit(true);
        end;
        exit(false);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CRM Setup Defaults", 'OnAddEntityTableMapping', '', false, false)]
    local procedure HandleOnAddEntityTableMapping(var TempNameValueBuffer: Record "Name/Value Buffer" temporary)
    var
        CRMSetupDefaults: Codeunit "CRM Setup Defaults";
    begin
        CRMSetupDefaults.AddEntityTableMapping('${config.dataverseEntityName}', Database::"${config.bcTableName}", TempNameValueBuffer);
        CRMSetupDefaults.AddEntityTableMapping('${config.dataverseEntityName}', Database::"${dvTableName}", TempNameValueBuffer);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CDS Setup Defaults", 'OnAfterResetConfiguration', '', false, false)]
    local procedure HandleOnAfterResetConfiguration(CDSConnectionSetup: Record "CDS Connection Setup")
    var
        IntegrationTableMapping: Record "Integration Table Mapping";
        IntegrationFieldMapping: Record "Integration Field Mapping";
        DataverseRec: Record "${dvTableName}";
        BCRec: Record "${config.bcTableName}";
    begin
        InsertIntegrationTableMapping(
            IntegrationTableMapping, '${mappingName}',
            Database::"${config.bcTableName}", Database::"${dvTableName}",
            DataverseRec.FieldNo(${alQuote(dvTable.primaryKeyField)}),
            DataverseRec.FieldNo(ModifiedOn),
            '', '', true, IntegrationTableMapping.Direction::Bidirectional, 'Dataverse');

${fieldMappingCode}
    end;

    local procedure InsertIntegrationTableMapping(var IntegrationTableMapping: Record "Integration Table Mapping"; MappingName: Code[20]; TableNo: Integer; IntegrationTableNo: Integer; IntegrationTableUIDFieldNo: Integer; IntegrationTableModifiedFieldNo: Integer; TableFilter: Text; IntegrationTableFilter: Text; SynchOnlyCoupledRecords: Boolean; Direction: Integer; Prefix: Text[30])
    begin
        IntegrationTableMapping.CreateRecord(MappingName, TableNo, IntegrationTableNo,
            IntegrationTableUIDFieldNo, IntegrationTableModifiedFieldNo,
            TableFilter, IntegrationTableFilter, SynchOnlyCoupledRecords, Direction, Prefix);
    end;

    local procedure InsertIntegrationFieldMapping(IntegrationTableMappingName: Code[20]; TableFieldNo: Integer; IntegrationTableFieldNo: Integer; SynchDirection: Option; ConstValue: Text; ValidateField: Boolean; ValidateIntegrationTableField: Boolean)
    var
        IntegrationFieldMapping: Record "Integration Field Mapping";
    begin
        IntegrationFieldMapping.CreateRecord(IntegrationTableMappingName, TableFieldNo,
            IntegrationTableFieldNo, SynchDirection, ConstValue, ValidateField, ValidateIntegrationTableField);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CRM Integration Management", 'OnBeforeHandleCustomIntegrationTableMapping', '', false, false)]
    local procedure HandleCustomIntegrationTableMappingReset(var IsHandled: Boolean; IntegrationTableMappingName: Code[20])
    begin
        if IntegrationTableMappingName = '${mappingName}' then
            IsHandled := true;
    end;
}
`;
}

/**
 * Generate list page for browsing Dataverse records.
 */
export function generateListPage(config: DataverseConfig, dvTable: AltpgenTableInfo): string {
    const pageId = config.nextObjectId;
    const dvTableName = dvTable.tableName;
    const dvTableSafe = sanitizeIdentifier(dvTableName);

    // Pick user-visible fields (skip system/audit fields and lookup display name fields)
    const systemFields = ['CreatedOn', 'CreatedBy', 'ModifiedOn', 'ModifiedBy',
        'CreatedOnBehalfBy', 'ModifiedOnBehalfBy', 'OrganizationId', 'VersionNumber',
        'ImportSequenceNumber', 'OverriddenCreatedOn', 'TimeZoneRuleVersionNumber',
        'UTCConversionTimeZoneCode', 'ExchangeRate', 'TransactionCurrencyId',
        'statecode', 'StatusCode'];
    // Lookup display name fields: "XxxId" has a corresponding "XxxIdName" that is a flowfield
    const guidFieldNames = dvTable.fields.filter(f => f.type === 'GUID').map(f => f.name);
    const displayFields = dvTable.fields.filter(f =>
        !systemFields.includes(f.name) &&
        f.type !== 'GUID' &&
        !guidFieldNames.some(gf => f.name === gf + 'Name')
    );

    const fieldLines = displayFields.length > 0
        ? displayFields.map(f =>
            `                field(${alQuote(f.name)}; Rec.${alQuote(f.name)})\n` +
            `                {\n` +
            `                    ApplicationArea = All;\n` +
            `                    Caption = '${f.caption}';\n` +
            `                }`
        ).join('\n')
        : `                // No display fields found — add fields manually`;

    const pageName = truncateName(`${dvTableName} List`, 30);

    return `page ${pageId} "${pageName}"
{
    PageType = List;
    SourceTable = "${dvTableName}";
    Editable = false;
    ApplicationArea = All;
    UsageCategory = Lists;
    Caption = '${pageName}';

    layout
    {
        area(Content)
        {
            repeater(General)
            {
${fieldLines}
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(CreateFromDataverse)
            {
                ApplicationArea = All;
                Caption = 'Create in Business Central';
                Promoted = true;
                PromotedCategory = Process;
                Image = NewItem;

                trigger OnAction()
                var
                    CRMIntegrationManagement: Codeunit "CRM Integration Management";
                begin
                    CurrPage.SetSelectionFilter(Rec);
                    CRMIntegrationManagement.CreateNewRecordsFromCRM(Rec);
                end;
            }
        }
    }

    var
        CurrentlyCoupled${dvTableSafe}: Record "${dvTableName}";

    procedure SetCurrentlyCoupled${dvTableSafe}(${dvTableSafe}: Record "${dvTableName}")
    begin
        CurrentlyCoupled${dvTableSafe} := ${dvTableSafe};
    end;
}
`;
}

/**
 * Generate page extension for coupling/sync actions.
 * Returns empty string if no card page name was provided.
 */
export function generatePageExtension(config: DataverseConfig): string {
    if (!config.bcCardPageName) {
        return '';
    }

    const pageExtId = config.nextObjectId + 2;
    const extName = truncateName(`${config.bcTableName} DV Synch`, 30);

    return `pageextension ${pageExtId} "${extName}" extends "${config.bcCardPageName}"
{
    actions
    {
        addlast(navigation)
        {
            group(ActionGroupDataverse)
            {
                Caption = 'Dataverse';
                Visible = DataverseIntegrationEnabled;

                action(DataverseSynchronizeNow)
                {
                    Caption = 'Synchronize';
                    Image = Refresh;
                    Enabled = DataverseIsCoupledToRecord;
                    ToolTip = 'Send or get updated data to or from Dataverse.';

                    trigger OnAction()
                    var
                        CRMIntegrationManagement: Codeunit "CRM Integration Management";
                    begin
                        CRMIntegrationManagement.UpdateOneNow(Rec.RecordId);
                    end;
                }

                action(ManageDataverseCoupling)
                {
                    Caption = 'Set Up Coupling';
                    Image = LinkAccount;
                    ToolTip = 'Create or modify the coupling to a Dataverse record.';

                    trigger OnAction()
                    var
                        CRMIntegrationManagement: Codeunit "CRM Integration Management";
                    begin
                        CRMIntegrationManagement.DefineCoupling(Rec.RecordId);
                    end;
                }

                action(DeleteDataverseCoupling)
                {
                    Caption = 'Delete Coupling';
                    Image = UnLinkAccount;
                    Enabled = DataverseIsCoupledToRecord;
                    ToolTip = 'Delete the coupling to a Dataverse record.';

                    trigger OnAction()
                    var
                        CRMCouplingManagement: Codeunit "CRM Coupling Management";
                    begin
                        CRMCouplingManagement.RemoveCoupling(Rec.RecordId);
                    end;
                }
            }
        }
    }

    trigger OnOpenPage()
    begin
        DataverseIntegrationEnabled := CRMIntegrationManagement.IsCDSIntegrationEnabled();
    end;

    trigger OnAfterGetCurrRecord()
    begin
        if DataverseIntegrationEnabled then
            DataverseIsCoupledToRecord := CRMCouplingManagement.IsRecordCoupledToCRM(Rec.RecordId);
    end;

    var
        CRMIntegrationManagement: Codeunit "CRM Integration Management";
        CRMCouplingManagement: Codeunit "CRM Coupling Management";
        DataverseIntegrationEnabled: Boolean;
        DataverseIsCoupledToRecord: Boolean;
}
`;
}

function sanitizeIdentifier(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '');
}

