import { ALSubscriber } from '../../types';
import { EventIndexer } from './eventIndexer';

export class SubscriberMapper {
    constructor(private eventIndexer: EventIndexer) {}

    getAllSubscribers(): ALSubscriber[] {
        return this.eventIndexer.getAllSubscribers();
    }

    /**
     * Find subscribers FROM YOUR WORKSPACE that hook into a given event.
     * This is the key insight: "Does MY project already subscribe to this parent event?"
     */
    findSubscribersForEvent(objectName: string, eventName: string): ALSubscriber[] {
        return this.eventIndexer.getWorkspaceSubscribers().filter(sub =>
            sub.targetObjectName.toLowerCase() === objectName.toLowerCase() &&
            sub.targetEventName.toLowerCase() === eventName.toLowerCase()
        );
    }

    /**
     * Find ALL subscribers (workspace + dependencies) for an event.
     */
    findAllSubscribersForEvent(objectName: string, eventName: string): ALSubscriber[] {
        return this.eventIndexer.getAllSubscribers().filter(sub =>
            sub.targetObjectName.toLowerCase() === objectName.toLowerCase() &&
            sub.targetEventName.toLowerCase() === eventName.toLowerCase()
        );
    }

    findSubscribersByObject(objectName: string): ALSubscriber[] {
        return this.eventIndexer.getAllSubscribers().filter(sub =>
            sub.targetObjectName.toLowerCase().includes(objectName.toLowerCase())
        );
    }

    /**
     * Dead subscribers = subscribers in YOUR workspace pointing to events that don't exist
     * in either your workspace or dependencies.
     */
    findDeadSubscribers(): ALSubscriber[] {
        const allEvents = this.eventIndexer.getAllEvents();
        const workspaceSubscribers = this.eventIndexer.getWorkspaceSubscribers();

        return workspaceSubscribers.filter(sub => {
            const eventExists = allEvents.some(event =>
                event.objectName.toLowerCase() === sub.targetObjectName.toLowerCase() &&
                event.eventName.toLowerCase() === sub.targetEventName.toLowerCase()
            );
            return !eventExists;
        });
    }

    getSubscriberMap(): Map<string, ALSubscriber[]> {
        const map = new Map<string, ALSubscriber[]>();
        const subscribers = this.eventIndexer.getWorkspaceSubscribers();

        for (const sub of subscribers) {
            const key = `${sub.targetObjectName}::${sub.targetEventName}`;
            const existing = map.get(key) || [];
            existing.push(sub);
            map.set(key, existing);
        }

        return map;
    }
}
