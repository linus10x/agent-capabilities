export const effects = ["read", "write", "moves-money", "read-pii"] as const;

export type Effect = (typeof effects)[number];

const approvalBrand: unique symbol = Symbol("human-approval");

export type Approval = {
  readonly [approvalBrand]: "human-approval";
  readonly by: string;
  readonly at: string;
};

export function approve(by: string, at: string): Approval {
  if (by.trim().length === 0) {
    throw new Error("approver is required");
  }
  if (at.trim().length === 0) {
    throw new Error("approval time is required");
  }
  return { [approvalBrand]: "human-approval", by: by.trim(), at };
}

export function isApproval(value: unknown): value is Approval {
  return (
    typeof value === "object" &&
    value !== null &&
    approvalBrand in value &&
    (value as Approval)[approvalBrand] === "human-approval"
  );
}

export type IncludesMoney<E> = [Extract<E, "moves-money">] extends [never] ? false : true;
