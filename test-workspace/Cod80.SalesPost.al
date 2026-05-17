codeunit 80 "Sales-Post"
{
    trigger OnRun()
    begin
        // Main posting logic
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforePostSalesDoc(var SalesHeader: Record "Sales Header"; CommitIsSuppressed: Boolean; PreviewMode: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterPostSalesDoc(var SalesHeader: Record "Sales Header"; var SalesShipmentHeader: Record "Sales Shipment Header"; var SalesInvoiceHeader: Record "Sales Invoice Header")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCheckSalesDoc(var SalesHeader: Record "Sales Header"; var IsHandled: Boolean)
    begin
    end;

    [BusinessEvent(false)]
    procedure OnSalesDocPosted(DocNo: Code[20]; PostingDate: Date)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterFinalizePosting(var SalesHeader: Record "Sales Header"; EverythingInvoiced: Boolean)
    begin
    end;
}
