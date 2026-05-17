export interface ALEvent {
    eventName: string;
    eventType: 'IntegrationEvent' | 'BusinessEvent' | 'InternalEvent';
    objectType: string;
    objectId: number;
    objectName: string;
    parameters: string;
    filePath: string;
    line: number;
    isLocal: boolean;
    source: 'workspace' | 'dependency';
}

export interface ALSubscriber {
    procedureName: string;
    targetObjectType: string;
    targetObjectId: number;
    targetObjectName: string;
    targetEventName: string;
    targetElement: string;
    filePath: string;
    line: number;
    source: 'workspace' | 'dependency';
}

export interface ALObject {
    objectType: string;
    objectId: number;
    objectName: string;
    filePath: string;
    source: 'workspace' | 'dependency';
}

export interface ALField {
    fieldName: string;
    fieldId: number;
    dataType: string;
    objectName: string;
    objectType: string;
    filePath: string;
    line: number;
    source: 'workspace' | 'dependency';
}

export interface ALExtension {
    extensionType: 'tableextension' | 'pageextension' | 'enumextension' | 'reportextension';
    extensionId: number;
    extensionName: string;
    targetObject: string;
    filePath: string;
    line: number;
    source: 'workspace' | 'dependency';
}

export interface ALReference {
    referenceType: 'field' | 'table' | 'codeunit' | 'page' | 'enum' | 'procedure';
    targetName: string;
    context: string;  // surrounding code for context
    filePath: string;
    line: number;
    source: 'workspace' | 'dependency';
    projectName: string;
}
