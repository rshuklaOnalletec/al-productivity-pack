/**
 * Generates BC Page Script YAML from parsed repro steps.
 * Format reverse-engineered from real BC Page Scripting recordings.
 *
 * Known automationIds (system-wide constants):
 *   Confirm dialog: 8da61efd-0002-0003-0507-0b0d1113171d
 *   Error dialog:   00000000-0000-0000-0800-0000836bd2d2
 */

import { ParseResult } from './reproParser';
import { randomBytes } from 'crypto';
import { FieldResolver } from './fieldResolver';

export interface PageScriptOptions {
    name?: string;
    description?: string;
    profile?: string;
    fieldResolver?: FieldResolver;
    /** Manual overrides: key = "pageName|userFieldName" (lowercase), value = resolved field name */
    fieldOverrides?: Map<string, string>;
}

// BC system-wide automationIds for dialogs
const CONFIRM_AUTOMATION_ID = '8da61efd-0002-0003-0507-0b0d1113171d';

/** Generate a short random runtimeId (4 chars like BC uses). */
function genRuntimeId(): string {
    return 'b' + randomBytes(2).toString('hex').slice(0, 3);
}

/** Generate a telemetryId UUID v4. */
function genTelemetryId(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generatePageScriptYaml(parseResult: ParseResult, options: PageScriptOptions = {}): string {
    const lines: string[] = [];
    const name = options.name || 'ReproRecording';
    const description = options.description || 'Generated from repro steps';
    const profile = options.profile || 'BUSINESS MANAGER';
    const resolver = options.fieldResolver;
    const overrides = options.fieldOverrides;

    /** Resolve a field name: overrides → resolver → passthrough */
    function resolveField(page: string, userField: string): string {
        const key = `${page.toLowerCase()}|${userField.toLowerCase()}`;
        if (overrides?.has(key)) {
            return overrides.get(key)!;
        }
        if (resolver) {
            return resolver.resolveField(page, userField);
        }
        return userField;
    }

    // Header
    lines.push(`name: ${name}`);
    lines.push(`description: ${description}`);
    lines.push(`telemetryId: ${genTelemetryId()}`);
    lines.push('start:');
    lines.push(`  profile: ${profile}`);
    lines.push('steps:');

    // Track current page context
    let currentPage = '';
    let currentRuntimeId = '';
    let isFirstOpen = true;

    for (const step of parseResult.steps) {
        if (step.type === 'comment') {
            lines.push(`  # ${step.comment || step.rawLine}`);
            continue;
        }

        switch (step.type) {
            case 'open': {
                const pageName = step.page!;
                const runtimeId = genRuntimeId();

                if (isFirstOpen) {
                    // First page: navigate + page-shown
                    lines.push('  - type: navigate');
                    lines.push('    target:');
                    lines.push(`      - page: ${pageName}`);
                    lines.push(`    description: Navigate to ${pageName}`);
                    isFirstOpen = false;
                }
                // page-shown (declares active page context)
                lines.push('  - type: page-shown');
                lines.push('    source:');
                lines.push(`      page: ${pageName}`);
                lines.push('    modal: false');
                lines.push(`    runtimeId: ${runtimeId}`);
                lines.push(`    description: Page <caption>${pageName}</caption> was shown.`);

                currentPage = pageName;
                currentRuntimeId = runtimeId;
                break;
            }

            case 'action': {
                const actionName = step.action!;

                if (actionName.toLowerCase() === 'new') {
                    // System "New" action on list pages
                    lines.push('  - type: invoke');
                    lines.push('    target:');
                    lines.push(`      - page: ${currentPage}`);
                    lines.push(`        runtimeRef: ${currentRuntimeId}`);
                    lines.push('      - action: Control_New');
                    lines.push('    invokeType: New');
                    lines.push(`    description: Invoke New on <caption>New</caption>`);
                } else {
                    // Regular action (Release, Post, etc.)
                    lines.push('  - type: invoke');
                    lines.push('    target:');
                    lines.push(`      - page: ${currentPage}`);
                    lines.push(`        runtimeRef: ${currentRuntimeId}`);
                    lines.push(`      - action: ${actionName}`);
                    lines.push('    parameters: {}');
                    lines.push(`    description: Invoke <caption>${actionName}</caption>`);
                }
                break;
            }

            case 'input': {
                const fieldName = resolveField(currentPage, step.field!);
                const value = step.value!;
                lines.push('  - type: input');
                lines.push('    target:');
                lines.push(`      - page: ${currentPage}`);
                lines.push(`        runtimeRef: ${currentRuntimeId}`);
                lines.push(`      - field: ${fieldName}`);
                lines.push(`    value: "${escapeYaml(value)}"`);
                lines.push(`    description: Input <value>${value}</value> into <caption>${fieldName}</caption>`);
                break;
            }

            case 'subpage-input': {
                const part = step.part!;
                const fieldName = resolveField(currentPage, step.field!);
                const value = step.value!;
                // Subpage target path: page → part → subform page → repeater → field
                // Resolve subform page from AL source, or fall back to "CurrentPage Subform"
                const subformPage = (resolver && resolver.resolvePartSubform(currentPage, part))
                    || step.subformPage
                    || `${currentPage} Subform`;
                lines.push('  - type: input');
                lines.push('    target:');
                lines.push(`      - page: ${currentPage}`);
                lines.push(`        runtimeRef: ${currentRuntimeId}`);
                lines.push(`      - part: ${part}`);
                lines.push(`      - page: ${subformPage}`);
                lines.push('      - repeater: Control1');
                lines.push(`      - field: ${fieldName}`);
                lines.push(`    value: "${escapeYaml(value)}"`);
                lines.push(`    description: Input <value>${value}</value> into <caption>${fieldName}</caption>`);
                break;
            }

            case 'confirm': {
                const confirmValue = step.value!.toLowerCase();
                const isYes = ['yes', 'ok', 'true', 'accept'].includes(confirmValue);
                const invokeType = isYes ? 'Yes' : 'No';
                const dialogRuntimeId = genRuntimeId();

                // page-shown for confirm dialog
                lines.push('  - type: page-shown');
                lines.push('    source:');
                lines.push('      page: null');
                lines.push(`      automationId: ${CONFIRM_AUTOMATION_ID}`);
                lines.push('      caption: Confirm');
                lines.push('    modal: true');
                lines.push(`    runtimeId: ${dialogRuntimeId}`);
                lines.push('    description: Page <caption>Confirm</caption> was shown.');
                // invoke Yes/No
                lines.push('  - type: invoke');
                lines.push('    target:');
                lines.push('      - page: null');
                lines.push(`        automationId: ${CONFIRM_AUTOMATION_ID}`);
                lines.push('        caption: Confirm');
                lines.push(`        runtimeRef: ${dialogRuntimeId}`);
                lines.push(`    invokeType: ${invokeType}`);
                lines.push(`    description: Invoke ${invokeType} on <caption>Confirm</caption>`);
                // page-closed
                lines.push('  - type: page-closed');
                lines.push('    source:');
                lines.push('      page: null');
                lines.push(`    runtimeId: ${dialogRuntimeId}`);
                lines.push('    description: Page <caption>Confirm</caption> was closed.');
                break;
            }

            case 'choose': {
                const choiceIndex = step.choiceIndex!;
                const dialogRuntimeId = genRuntimeId();

                // page-shown for Choose dialog (StrMenu)
                lines.push('  - type: page-shown');
                lines.push('    source:');
                lines.push('      page: null');
                lines.push(`      automationId: ${CONFIRM_AUTOMATION_ID}`);
                lines.push('      caption: Choose');
                lines.push('    modal: true');
                lines.push(`    runtimeId: ${dialogRuntimeId}`);
                lines.push('    description: Page <caption>Choose</caption> was shown.');
                // input the option index
                lines.push('  - type: input');
                lines.push('    target:');
                lines.push('      - page: null');
                lines.push(`        automationId: ${CONFIRM_AUTOMATION_ID}`);
                lines.push('        caption: Choose');
                lines.push(`        runtimeRef: ${dialogRuntimeId}`);
                lines.push('      - field: "AL:STRMENU"');
                lines.push(`    value: ${choiceIndex}`);
                lines.push(`    description: Input <value>${choiceIndex}</value> into <caption>AL:STRMENU</caption>`);
                // invoke Ok
                lines.push('  - type: invoke');
                lines.push('    target:');
                lines.push('      - page: null');
                lines.push(`        automationId: ${CONFIRM_AUTOMATION_ID}`);
                lines.push('        caption: Choose');
                lines.push(`        runtimeRef: ${dialogRuntimeId}`);
                lines.push('    invokeType: Ok');
                lines.push('    description: Invoke Ok on <caption>Choose</caption>');
                // page-closed
                lines.push('  - type: page-closed');
                lines.push('    source:');
                lines.push('      page: null');
                lines.push(`    runtimeId: ${dialogRuntimeId}`);
                lines.push('    description: Page <caption>Choose</caption> was closed.');
                break;
            }

            case 'validate': {
                const fieldName = resolveField(currentPage, step.field!);
                const value = step.value!;
                lines.push('  - type: validate');
                lines.push('    target:');
                lines.push(`      - page: ${currentPage}`);
                lines.push(`        runtimeRef: ${currentRuntimeId}`);
                lines.push(`      - field: ${fieldName}`);
                lines.push('    operator: is');
                lines.push(`    value: "${escapeYaml(value)}"`);
                lines.push(`    description: Validate <caption>${fieldName}</caption> is <value>${value}</value>`);
                break;
            }

            case 'wait': {
                lines.push('  - type: wait');
                lines.push(`    time: ${step.waitMs}`);
                lines.push(`    description: Wait ${step.waitMs}ms`);
                break;
            }
        }
    }

    return lines.join('\n') + '\n';
}

function escapeYaml(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generate a filename-safe string from a description.
 */
export function generateFileName(description?: string): string {
    if (!description) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `repro-${timestamp}.yml`;
    }
    const safe = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
    return `repro-${safe}.yml`;
}
