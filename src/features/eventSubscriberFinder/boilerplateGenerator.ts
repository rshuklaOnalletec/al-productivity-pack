import { ALEvent } from '../../types';

export class BoilerplateGenerator {
    generate(event: ALEvent): string {
        const subscriberParams = event.parameters || '';
        const objectTypeEnum = this.mapObjectType(event.objectType);

        const snippet = `
    [EventSubscriber(ObjectType::${objectTypeEnum}, ${objectTypeEnum}::"${event.objectName}", '${event.eventName}', '', false, false)]
    local procedure \${1:On${event.eventName}}(${subscriberParams})
    begin
        \${0:// TODO: Implement subscriber logic}
    end;`;

        return snippet.trim();
    }

    generatePlainText(event: ALEvent): string {
        const subscriberParams = event.parameters || '';
        const objectTypeEnum = this.mapObjectType(event.objectType);

        return `    [EventSubscriber(ObjectType::${objectTypeEnum}, ${objectTypeEnum}::"${event.objectName}", '${event.eventName}', '', false, false)]
    local procedure On${event.eventName}(${subscriberParams})
    begin
        // TODO: Implement subscriber logic
    end;`;
    }

    private mapObjectType(objectType: string): string {
        const mapping: Record<string, string> = {
            'codeunit': 'Codeunit',
            'table': 'Table',
            'tableextension': 'Table',
            'page': 'Page',
            'pageextension': 'Page',
            'report': 'Report',
            'xmlport': 'XMLport',
            'query': 'Query'
        };

        return mapping[objectType.toLowerCase()] || 'Codeunit';
    }
}
