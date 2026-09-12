import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkSubject: v.string(),
    email: v.optional(v.string()),
  }).index("by_clerk_subject", ["clerkSubject"]),
  households: defineTable({
    ownerUserId: v.id("users"),
    name: v.string(),
  }).index("by_owner", ["ownerUserId"]),
  householdMembers: defineTable({
    householdId: v.id("households"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("viewer")),
  })
    .index("by_user", ["userId"])
    .index("by_household_user", ["householdId", "userId"]),
});
