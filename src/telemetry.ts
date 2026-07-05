import * as vscode from 'vscode';

/**
 * Lightweight telemetry service using VS Code's native TelemetryLogger API.
 * Automatically respects user's telemetry.telemetryLevel setting.
 * 
 * Currently uses a no-op sender (logs locally in dev).
 * Swap the sender implementation to route to App Insights or custom backend.
 */

let logger: vscode.TelemetryLogger | undefined;

// Event name constants
export const TelemetryEvents = {
    // Activation
    Activated: 'extension/activated',
    
    // Commands
    FindEvents: 'command/findEvents',
    FindSubscribers: 'command/findSubscribers',
    GenerateSubscriber: 'command/generateSubscriber',
    GenerateSubscriberForEvent: 'command/generateSubscriberForEvent',
    ShowEventChain: 'command/showEventChain',
    DetectDeadSubscribers: 'command/detectDeadSubscribers',
    FileInsights: 'command/fileInsights',
    ShowAppDependencyGraph: 'command/showAppDependencyGraph',
    RefreshIndex: 'command/refreshIndex',
    PeekSubscribersAtCursor: 'command/peekSubscribersAtCursor',
    PeekDependenciesAtCursor: 'command/peekDependenciesAtCursor',
    GeneratePageScript: 'command/generatePageScript',
    GenerateDataverseIntegration: 'command/generateDataverseIntegration',
    ClearDataverseCredentials: 'command/clearDataverseCredentials',
    AddTelemetry: 'command/addTelemetry',

    // Performance
    IndexingCompleted: 'perf/indexingCompleted',

    // Errors
    CommandError: 'error/command',
} as const;

class ExtensionTelemetrySender implements vscode.TelemetrySender {
    sendEventData(eventName: string, data?: Record<string, any>): void {
        // No-op for now. Replace with actual transport (e.g., App Insights, PostHog)
        // when ready to collect telemetry remotely.
        console.log(`[Telemetry] ${eventName}`, JSON.stringify(data));
    }

    sendErrorData(error: Error, data?: Record<string, any>): void {
        console.log(`[Telemetry:Error] ${error.message}`, JSON.stringify(data));
    }

    flush(): void {
        // No-op
    }
}

export function initTelemetry(context: vscode.ExtensionContext): void {
    const sender = new ExtensionTelemetrySender();
    logger = vscode.env.createTelemetryLogger(sender, {
        ignoreBuiltInCommonProperties: false,
        ignoreUnhandledErrors: true,
        additionalCommonProperties: {
            'extension.version': context.extension.packageJSON.version ?? 'unknown',
        }
    });
    context.subscriptions.push(logger);
}

export function logUsage(eventName: string, data?: Record<string, number | string | boolean>): void {
    logger?.logUsage(eventName, data);
}

export function logError(eventName: string, error?: Error, data?: Record<string, number | string | boolean>): void {
    if (error) {
        logger?.logError(error, { eventName, ...data });
    } else {
        logger?.logUsage(eventName, { ...data, isError: true });
    }
}

export function disposeTelemetry(): void {
    logger?.dispose();
    logger = undefined;
}
