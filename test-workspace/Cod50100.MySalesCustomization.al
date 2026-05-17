codeunit 50100 "My Sales Customization"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Sales-Post", 'OnBeforePostSalesDoc', '', false, false)]
    local procedure MyOnBeforePostSalesDoc(var SalesHeader: Record "Sales Header"; CommitIsSuppressed: Boolean; PreviewMode: Boolean)
    begin
        // Custom validation before posting
        if SalesHeader."Sell-to Customer No." = '' then
            Error('Customer must be specified');
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Sales-Post", 'OnNonExistentEvent', '', false, false)]
    local procedure DeadSubscriberExample(var SalesHeader: Record "Sales Header")
    begin
        // This subscriber is "dead" - the event doesn't exist
    end;
}
