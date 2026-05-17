codeunit 90 "Purch.-Post"
{
    [IntegrationEvent(false, false)]
    local procedure OnBeforePostPurchDoc(var PurchaseHeader: Record "Purchase Header"; PreviewMode: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterPostPurchDoc(var PurchaseHeader: Record "Purchase Header"; var PurchRcptHeader: Record "Purch. Rcpt. Header")
    begin
    end;

    [BusinessEvent(false)]
    procedure OnPurchaseDocPosted(DocNo: Code[20]; VendorNo: Code[20])
    begin
    end;
}
