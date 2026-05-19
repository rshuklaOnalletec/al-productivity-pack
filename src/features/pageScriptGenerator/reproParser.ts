/**
 * Parses structured repro steps (DSL) into an intermediate representation.
 * 
 * Supported DSL syntax:
 *   Open "Page Name"
 *   Click "Action Name"
 *   Click "New"                         → system New action on list pages
 *   Set "Field Name" = "Value"
 *   In "Part" Set "Field" = "Value"     → subpage/lines field input
 *   Confirm "Yes" | Confirm "No"
 *   Choose N                            → StrMenu option (0-based index)
 *   Validate "Field Name" = "Expected"
 *   Wait 1000
 *   # Comment
 */

export type StepType = 'open' | 'action' | 'input' | 'subpage-input' | 'confirm' | 'choose' | 'validate' | 'wait' | 'comment';

export interface ReproStep {
    type: StepType;
    page?: string;
    action?: string;
    field?: string;
    value?: string;
    part?: string;
    subformPage?: string;
    operator?: string;
    waitMs?: number;
    choiceIndex?: number;
    comment?: string;
    rawLine: string;
    lineNumber: number;
}

export interface ParseResult {
    steps: ReproStep[];
    errors: { line: number; message: string }[];
}

const PATTERNS: { type: StepType; regex: RegExp; extract: (match: RegExpMatchArray) => Partial<ReproStep> }[] = [
    {
        type: 'open',
        regex: /^(?:open|navigate|go\s*to)\s+["'](.+?)["']/i,
        extract: (m) => ({ page: m[1] })
    },
    {
        // Quoted part + quoted field + quoted value
        type: 'subpage-input',
        regex: /^(?:in)\s+["'](.+?)["']\s+(?:set|input|enter)\s+["'](.+?)["']\s*=\s*["'](.+?)["']/i,
        extract: (m) => ({ part: m[1], field: m[2], value: m[3] })
    },
    {
        // Quoted part + unquoted field = quoted value
        type: 'subpage-input',
        regex: /^(?:in)\s+["'](.+?)["']\s+(?:set|input|enter)\s+(.+?)\s*=\s*["'](.+?)["']/i,
        extract: (m) => ({ part: m[1], field: m[2].trim(), value: m[3] })
    },
    {
        type: 'action',
        regex: /^(?:click|action|press|select\s+action|invoke)\s+["'](.+?)["']/i,
        extract: (m) => ({ action: m[1] })
    },
    {
        // Quoted field = quoted value
        type: 'input',
        regex: /^(?:set|input|enter|fill|type)\s+["'](.+?)["']\s*=\s*["'](.+?)["']/i,
        extract: (m) => ({ field: m[1], value: m[2] })
    },
    {
        // Unquoted field = quoted value (e.g., Set Name = "Test")
        type: 'input',
        regex: /^(?:set|input|enter|fill|type)\s+(.+?)\s*=\s*["'](.+?)["']/i,
        extract: (m) => ({ field: m[1].trim(), value: m[2] })
    },
    {
        type: 'confirm',
        regex: /^(?:confirm|dialog|accept|dismiss)\s+["']?(yes|no|ok|cancel|true|false)["']?/i,
        extract: (m) => ({ value: m[1] })
    },
    {
        type: 'choose',
        regex: /^(?:choose|select\s+option|option)\s+(\d+)/i,
        extract: (m) => ({ choiceIndex: parseInt(m[1], 10) })
    },
    {
        // Quoted field = quoted value
        type: 'validate',
        regex: /^(?:validate|assert|check|verify)\s+["'](.+?)["']\s*=\s*["'](.+?)["']/i,
        extract: (m) => ({ field: m[1], value: m[2], operator: 'equals' })
    },
    {
        // Unquoted field = quoted value
        type: 'validate',
        regex: /^(?:validate|assert|check|verify)\s+(.+?)\s*=\s*["'](.+?)["']/i,
        extract: (m) => ({ field: m[1].trim(), value: m[2], operator: 'equals' })
    },
    {
        type: 'wait',
        regex: /^(?:wait|delay|pause)\s+(\d+)/i,
        extract: (m) => ({ waitMs: parseInt(m[1], 10) })
    },
    {
        type: 'comment',
        regex: /^(?:#|\/\/|comment\s+)(.*)/i,
        extract: (m) => ({ comment: m[1].trim() })
    }
];

export function parseReproSteps(input: string): ParseResult {
    const lines = input.split('\n');
    const steps: ReproStep[] = [];
    const errors: { line: number; message: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();

        // Skip empty lines
        if (!raw) {
            continue;
        }

        // Skip numbered prefixes like "1." or "1)"
        const cleaned = raw.replace(/^\d+[\.\)]\s*/, '');

        let matched = false;
        for (const pattern of PATTERNS) {
            const match = cleaned.match(pattern.regex);
            if (match) {
                steps.push({
                    type: pattern.type,
                    ...pattern.extract(match),
                    rawLine: raw,
                    lineNumber: i + 1
                });
                matched = true;
                break;
            }
        }

        if (!matched) {
            errors.push({
                line: i + 1,
                message: `Could not parse: "${raw}". Use format like: Open "Page", Set "Field" = "Value", Click "Action"`
            });
        }
    }

    return { steps, errors };
}
