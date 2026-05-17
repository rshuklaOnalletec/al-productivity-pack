import * as assert from 'assert';
import { parseALFile } from '../../utils/alParser';

suite('AL Parser Test Suite', () => {
    test('Should parse IntegrationEvent', () => {
        const alCode = `codeunit 80 "Sales-Post"
{
    [IntegrationEvent(false, false)]
    local procedure OnBeforePostSalesDoc(var SalesHeader: Record "Sales Header"; CommitIsSuppressed: Boolean)
    begin
    end;
}`;

        const result = parseALFile(alCode, '/test/salespost.al');

        assert.strictEqual(result.events.length, 1);
        assert.strictEqual(result.events[0].eventName, 'OnBeforePostSalesDoc');
        assert.strictEqual(result.events[0].eventType, 'IntegrationEvent');
        assert.strictEqual(result.events[0].objectName, 'Sales-Post');
        assert.strictEqual(result.events[0].objectId, 80);
        assert.strictEqual(result.events[0].isLocal, true);
    });

    test('Should parse BusinessEvent', () => {
        const alCode = `codeunit 90 "Purch.-Post"
{
    [BusinessEvent(false)]
    procedure OnAfterPostPurchaseDoc(var PurchaseHeader: Record "Purchase Header")
    begin
    end;
}`;

        const result = parseALFile(alCode, '/test/purchpost.al');

        assert.strictEqual(result.events.length, 1);
        assert.strictEqual(result.events[0].eventName, 'OnAfterPostPurchaseDoc');
        assert.strictEqual(result.events[0].eventType, 'BusinessEvent');
        assert.strictEqual(result.events[0].isLocal, false);
    });

    test('Should parse EventSubscriber', () => {
        const alCode = `codeunit 50100 "My Customization"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Sales-Post", 'OnBeforePostSalesDoc', '', false, false)]
    local procedure MyOnBeforePostSalesDoc(var SalesHeader: Record "Sales Header"; CommitIsSuppressed: Boolean)
    begin
        // Custom logic
    end;
}`;

        const result = parseALFile(alCode, '/test/mycustomization.al');

        assert.strictEqual(result.subscribers.length, 1);
        assert.strictEqual(result.subscribers[0].procedureName, 'MyOnBeforePostSalesDoc');
        assert.strictEqual(result.subscribers[0].targetObjectType, 'Codeunit');
        assert.strictEqual(result.subscribers[0].targetObjectName, 'Sales-Post');
        assert.strictEqual(result.subscribers[0].targetEventName, 'OnBeforePostSalesDoc');
    });

    test('Should parse object declarations', () => {
        const alCode = `codeunit 50100 "My Codeunit"
{
    procedure DoSomething()
    begin
    end;
}`;

        const result = parseALFile(alCode, '/test/mycodeunit.al');

        assert.strictEqual(result.objects.length, 1);
        assert.strictEqual(result.objects[0].objectType, 'codeunit');
        assert.strictEqual(result.objects[0].objectId, 50100);
        assert.strictEqual(result.objects[0].objectName, 'My Codeunit');
    });

    test('Should handle multiple events in one file', () => {
        const alCode = `codeunit 80 "Sales-Post"
{
    [IntegrationEvent(false, false)]
    local procedure OnBeforePostSalesDoc(var SalesHeader: Record "Sales Header")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterPostSalesDoc(var SalesHeader: Record "Sales Header")
    begin
    end;

    [BusinessEvent(false)]
    procedure OnCustomBusinessEvent(DocNo: Code[20])
    begin
    end;
}`;

        const result = parseALFile(alCode, '/test/salespost.al');

        assert.strictEqual(result.events.length, 3);
        assert.strictEqual(result.events[0].eventName, 'OnBeforePostSalesDoc');
        assert.strictEqual(result.events[1].eventName, 'OnAfterPostSalesDoc');
        assert.strictEqual(result.events[2].eventName, 'OnCustomBusinessEvent');
        assert.strictEqual(result.events[2].eventType, 'BusinessEvent');
    });

    test('Should return empty arrays for file with no events', () => {
        const alCode = `codeunit 50100 "Helper"
{
    procedure DoSomething()
    begin
        Message('Hello');
    end;
}`;

        const result = parseALFile(alCode, '/test/helper.al');

        assert.strictEqual(result.events.length, 0);
        assert.strictEqual(result.subscribers.length, 0);
        assert.strictEqual(result.objects.length, 1);
    });
});
