/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_parseImport from "../actions/parseImport.js";
import type * as crons from "../crons.js";
import type * as importCleanup from "../importCleanup.js";
import type * as importWorkers from "../importWorkers.js";
import type * as imports from "../imports.js";
import type * as model_auth from "../model/auth.js";
import type * as model_importLimits from "../model/importLimits.js";
import type * as model_importRetention from "../model/importRetention.js";
import type * as model_importValidators from "../model/importValidators.js";
import type * as model_imports from "../model/imports.js";
import type * as model_users from "../model/users.js";
import type * as testing_seed from "../testing/seed.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/parseImport": typeof actions_parseImport;
  crons: typeof crons;
  importCleanup: typeof importCleanup;
  importWorkers: typeof importWorkers;
  imports: typeof imports;
  "model/auth": typeof model_auth;
  "model/importLimits": typeof model_importLimits;
  "model/importRetention": typeof model_importRetention;
  "model/importValidators": typeof model_importValidators;
  "model/imports": typeof model_imports;
  "model/users": typeof model_users;
  "testing/seed": typeof testing_seed;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
