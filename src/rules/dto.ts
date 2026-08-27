import { z } from 'zod';

import { RULE_ACTIONS, RULE_CONDITION_FIELDS, RULE_CONDITION_OPERATORS } from '../database/schema';

// The DB has the same check, but failing here gives a 400 naming the field instead of a 500.
export const ruleSchema = z
  .object({
    conditionField: z.enum(RULE_CONDITION_FIELDS),
    conditionOperator: z.enum(RULE_CONDITION_OPERATORS),
    conditionValue: z.string().trim().min(1).max(500),
    action: z.enum(RULE_ACTIONS),
    targetFolder: z.string().trim().min(1).max(255).nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((value) => value.action !== 'move_to' || value.targetFolder !== null, {
    message: 'targetFolder is required when the action is move_to',
    path: ['targetFolder'],
  });

export type RuleRequest = z.infer<typeof ruleSchema>;

export const reorderRulesSchema = z.object({ ruleIds: z.array(z.uuid()).min(1) });
export type ReorderRulesRequest = z.infer<typeof reorderRulesSchema>;

export interface RuleResponse {
  readonly id: string;
  readonly mailboxId: string;
  readonly position: number;
  readonly active: boolean;
  readonly conditionField: string;
  readonly conditionOperator: string;
  readonly conditionValue: string;
  readonly action: string;
  readonly targetFolder: string | null;
}

export const rulePreviewSchema = z.object({
  conditionField: z.enum(RULE_CONDITION_FIELDS),
  conditionOperator: z.enum(RULE_CONDITION_OPERATORS),
  conditionValue: z.string().trim().min(1).max(500),
});
export type RulePreviewRequest = z.infer<typeof rulePreviewSchema>;

export interface RulePreviewResponse {
  // False for `recipient`: the projection keeps the sender, so there is nothing to count against.
  readonly supported: boolean;
  readonly total: number;
  readonly sample: readonly {
    id: string;
    sender: string;
    subject: string | null;
    receivedAt: string;
  }[];
}
