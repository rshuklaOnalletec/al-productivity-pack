import { ALEvent, ALSubscriber, ALObject } from '../types';

type ParsedEvent = Omit<ALEvent, 'source'>;
type ParsedSubscriber = Omit<ALSubscriber, 'source'>;
type ParsedObject = Omit<ALObject, 'source'>;

const OBJECT_PATTERN = /^\s*(codeunit|table|tableextension|page|pageextension|report|xmlport|query|enum|enumextension|interface)\s+(\d+)\s+"?([^"{\n]+)"?/i;


const EVENT_ATTRIBUTE_PATTERN = /\[(IntegrationEvent|BusinessEvent|InternalEvent)\s*\((true|false)(?:\s*,\s*(true|false))?\s*\)\]/i;

const PROCEDURE_PATTERN = /(?:local\s+)?procedure\s+(\w+)\s*\(([^)]*)\)/i;

const SUBSCRIBER_PATTERN = /\[EventSubscriber\s*\(\s*ObjectType\s*::\s*(\w+)\s*,\s*(?:Database|Codeunit|Page|Report|XMLport|Query)\s*::\s*"?([^"',]+)"?\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*,\s*(true|false)\s*\)\]/i;

export function parseALFile(content: string, filePath: string): { events: ParsedEvent[]; subscribers: ParsedSubscriber[]; objects: ParsedObject[] } {
    const lines = content.split('\n');
    const events: ParsedEvent[] = [];
    const subscribers: ParsedSubscriber[] = [];
    const objects: ParsedObject[] = [];

    let currentObject: ParsedObject | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect object declaration
        const objectMatch = line.match(OBJECT_PATTERN);
        if (objectMatch) {
            currentObject = {
                objectType: objectMatch[1],
                objectId: parseInt(objectMatch[2], 10),
                objectName: objectMatch[3].trim(),
                filePath
            };
            objects.push(currentObject);
        }

        // Detect event publisher attribute
        const eventAttrMatch = line.match(EVENT_ATTRIBUTE_PATTERN);
        if (eventAttrMatch && currentObject) {
            // Look ahead for the procedure declaration
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const procMatch = lines[j].match(PROCEDURE_PATTERN);
                if (procMatch) {
                    const isLocal = lines[j].trim().startsWith('local');
                    events.push({
                        eventName: procMatch[1],
                        eventType: eventAttrMatch[1] as ALEvent['eventType'],
                        objectType: currentObject.objectType,
                        objectId: currentObject.objectId,
                        objectName: currentObject.objectName,
                        parameters: procMatch[2].trim(),
                        filePath,
                        line: j,
                        isLocal
                    });
                    break;
                }
            }
        }

        // Detect event subscriber attribute
        const subscriberMatch = line.match(SUBSCRIBER_PATTERN);
        if (subscriberMatch) {
            // Look ahead for the procedure declaration
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const procMatch = lines[j].match(PROCEDURE_PATTERN);
                if (procMatch) {
                    subscribers.push({
                        procedureName: procMatch[1],
                        targetObjectType: subscriberMatch[1],
                        targetObjectId: 0, // Will be resolved later
                        targetObjectName: subscriberMatch[2].trim(),
                        targetEventName: subscriberMatch[3],
                        targetElement: subscriberMatch[4],
                        filePath,
                        line: j
                    });
                    break;
                }
            }
        }
    }

    return { events, subscribers, objects };
}
