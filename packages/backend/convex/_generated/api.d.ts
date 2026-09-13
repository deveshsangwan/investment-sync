/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as actions_parseImport from "../actions/parseImport.js";
import type * as actions_publishPortfolio from "../actions/publishPortfolio.js";
import type * as actions_refreshCurrencyRate from "../actions/refreshCurrencyRate.js";
import type * as crons from "../crons.js";
import type * as currencyRates from "../currencyRates.js";
import type * as importCleanup from "../importCleanup.js";
import type * as importWorkers from "../importWorkers.js";
import type * as imports from "../imports.js";
import type * as model_auth from "../model/auth.js";
import type * as model_currencyRates from "../model/currencyRates.js";
import type * as model_importLimits from "../model/importLimits.js";
import type * as model_importRetention from "../model/importRetention.js";
import type * as model_importValidators from "../model/importValidators.js";
import type * as model_imports from "../model/imports.js";
import type * as model_portfolioEncoding from "../model/portfolioEncoding.js";
import type * as model_portfolioLimits from "../model/portfolioLimits.js";
import type * as model_portfolioReads from "../model/portfolioReads.js";
import type * as model_portfolioValidators from "../model/portfolioValidators.js";
import type * as model_publication from "../model/publication.js";
import type * as model_publicationFacts from "../model/publicationFacts.js";
import type * as model_publicationProjection from "../model/publicationProjection.js";
import type * as model_publicationReadBudget from "../model/publicationReadBudget.js";
import type * as model_publicationStages from "../model/publicationStages.js";
import type * as model_publicationWriter from "../model/publicationWriter.js";
import type * as model_readEncoding from "../model/readEncoding.js";
import type * as model_users from "../model/users.js";
import type * as portfolio from "../portfolio.js";
import type * as publicationCleanup from "../publicationCleanup.js";
import type * as publicationInput from "../publicationInput.js";
import type * as publicationWorkers from "../publicationWorkers.js";
import type * as testing_publicationCapacity from "../testing/publicationCapacity.js";
import type * as testing_publicationDocumentSizes from "../testing/publicationDocumentSizes.js";
import type * as testing_seed from "../testing/seed.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  "actions/parseImport": typeof actions_parseImport;
  "actions/publishPortfolio": typeof actions_publishPortfolio;
  "actions/refreshCurrencyRate": typeof actions_refreshCurrencyRate;
  crons: typeof crons;
  currencyRates: typeof currencyRates;
  importCleanup: typeof importCleanup;
  importWorkers: typeof importWorkers;
  imports: typeof imports;
  "model/auth": typeof model_auth;
  "model/currencyRates": typeof model_currencyRates;
  "model/importLimits": typeof model_importLimits;
  "model/importRetention": typeof model_importRetention;
  "model/importValidators": typeof model_importValidators;
  "model/imports": typeof model_imports;
  "model/portfolioEncoding": typeof model_portfolioEncoding;
  "model/portfolioLimits": typeof model_portfolioLimits;
  "model/portfolioReads": typeof model_portfolioReads;
  "model/portfolioValidators": typeof model_portfolioValidators;
  "model/publication": typeof model_publication;
  "model/publicationFacts": typeof model_publicationFacts;
  "model/publicationProjection": typeof model_publicationProjection;
  "model/publicationReadBudget": typeof model_publicationReadBudget;
  "model/publicationStages": typeof model_publicationStages;
  "model/publicationWriter": typeof model_publicationWriter;
  "model/readEncoding": typeof model_readEncoding;
  "model/users": typeof model_users;
  portfolio: typeof portfolio;
  publicationCleanup: typeof publicationCleanup;
  publicationInput: typeof publicationInput;
  publicationWorkers: typeof publicationWorkers;
  "testing/publicationCapacity": typeof testing_publicationCapacity;
  "testing/publicationDocumentSizes": typeof testing_publicationDocumentSizes;
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
