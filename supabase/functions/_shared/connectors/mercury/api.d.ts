/**
 * Mercury GET types. Do not edit by hand.
 * Generated from the OpenAPI JSON embedded in:
 * https://docs.mercury.com/reference/getaccounts.md
 * https://docs.mercury.com/reference/listtransactions.md
 * https://docs.mercury.com/reference/gettransactionbyid.md
 *
 *   node scripts/mercury-openapi.mjs
 *
 * Account numbers, routing numbers, emails, and attachment URLs are in the
 * response schemas. Flow does not store them. See docs/tech/connector-contract.md.
 */

export interface paths {
    "/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all accounts
         * @description Retrieve a paginated list of accounts. Supports cursor-based pagination with limit, order, start_after, and end_before query parameters.
         */
        get: operations["getAccounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List all transactions
         * @description Retrieve a paginated list of all transactions across all accounts. Supports advanced filtering by date ranges, status, categories, and cursor-based pagination.
         */
        get: operations["listTransactions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transaction/{transactionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a transaction by ID
         * @description Retrieve a single transaction by its ID. Returns full transaction details including attachments, check images, and related metadata.
         */
        get: operations["getTransactionById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Account: {
            accountNumber: string;
            availableBalance: number;
            canReceiveTransactions?: boolean | null;
            /**
             * @description Whether this account's partner bank supports sending real-time payments.
             *      Sending one also requires the recipient's routing number to be RTP-eligible.
             */
            canSendRealTimePayments: boolean;
            createdAt: components["schemas"]["UTCTime"];
            currentBalance: number;
            dashboardLink: string;
            id: components["schemas"]["TransactionPartyId"];
            kind: string;
            legalBusinessName: string;
            name: string;
            nickname?: string | null;
            routingNumber: string;
            status: components["schemas"]["AccountStatus"];
            type: components["schemas"]["AccountType"];
        };
        /** @enum {string} */
        AccountStatus: "active" | "deleted" | "pending" | "archived";
        /** @enum {string} */
        AccountType: "mercury" | "external" | "recipient";
        /**
         * @description Paginated response containing a list of accounts.
         *      | Use the page cursor information to fetch additional pages of accounts.
         */
        AccountsPaginatedResponse: {
            /** @description List of accounts in the current page */
            accounts: components["schemas"]["Account"][];
            /** @description Pagination information including cursors for navigating to next/previous pages */
            page: {
                nextPage?: components["schemas"]["TransactionPartyId"];
                previousPage?: components["schemas"]["TransactionPartyId"];
            };
        };
        /**
         * Format: uuid
         * @description ID for a Mercury account.
         */
        TransactionPartyId: string;
        /**
         * Format: yyyy-mm-ddThh:MM:ssZ
         * @example 2016-07-22T00:00:00Z
         */
        UTCTime: string;
        AddressData: {
            address1: string;
            address2?: string | null;
            city: string;
            postalCode: string;
            state?: components["schemas"]["USState"] | null;
        };
        AddressWithoutName: {
            address1: string;
            address2?: string | null;
            city: string;
            country: components["schemas"]["ISO3166Alpha2"];
            postalCode: string;
            region: components["schemas"]["Region"];
        };
        /** @description Represents an expense category for transaction classification. */
        CategoryData: {
            id: components["schemas"]["CategoryId"] & unknown;
            /** @description The name of the category */
            name: string;
            /** @description Whether this category is applicable to card transactions */
            visibleForCardSpend: boolean;
            /** @description Whether this category is applicable to all other transaction kinds */
            visibleForOther: boolean;
            /** @description Whether this category is applicable to expense reimbursement transactions */
            visibleForReimbursements: boolean;
        };
        /**
         * Format: uuid
         * @description ID for the category
         */
        CategoryId: string;
        /** Format: uuid */
        CreditCardId: string;
        CreditCardInfo: {
            email?: string | null;
            id: components["schemas"]["CreditCardId"] & unknown;
            paymentMethod: string;
        };
        CurrencyCode: string;
        CurrencyExchangeInfo: {
            convertedFromAmount: number;
            convertedFromCurrency: components["schemas"]["CurrencyCode"];
            convertedToAmount: number;
            convertedToCurrency: components["schemas"]["CurrencyCode"];
            /**
             * @description Exchange rate goes from "from currency" to "to currency"
             *      (ie from currency * exchange rate = to currency)
             */
            exchangeRate: number;
            feeAmount: number;
            feePercentage: number;
            feeTransactionId?: components["schemas"]["TransactionMetadataId"] | null;
        };
        /** Format: uuid */
        DebitCardId: string;
        DebitCardInfo: {
            id: components["schemas"]["DebitCardId"] & unknown;
        };
        DomesticWireRoutingInfo: {
            accountNumber: string;
            address?: components["schemas"]["AddressWithoutName"] | null;
            bankName?: string | null;
            routingNumber: string;
        };
        /** @enum {string} */
        ElectronicAccountType: "businessChecking" | "businessSavings" | "personalChecking" | "personalSavings" | "businessGeneralLedger" | "personalGeneralLedger" | "businessLoan" | "personalLoan";
        ElectronicRoutingInfo: {
            accountNumber: string;
            address?: components["schemas"]["AddressWithoutName"] | null;
            bankName?: string | null;
            electronicAccountType: components["schemas"]["ElectronicAccountType"];
            routingNumber: string;
        };
        /**
         * @description A GL code allocation on a transaction — a GL code name paired with the amount
         *      allocated to it. When a transaction is fully categorized, the amounts across all
         *      allocations sum to the transaction total.
         */
        GlAllocation: {
            /** @description The amount allocated to this GL code */
            amount: number;
            /** @description Optional user-provided description for this allocation */
            description?: string | null;
            /** @description The name of the GL code from the connected accounting integration */
            glCodeName: string;
        };
        ISO3166Alpha2: string;
        InternationalWireAustraliaSpecificData: {
            bsbCode: string;
        };
        InternationalWireBrazilSpecificData: {
            legalId: string;
        };
        InternationalWireCanadaSpecificData: {
            bankCode: string;
            transitNumber: string;
        };
        InternationalWireChileSpecificData: {
            legalId: string;
        };
        InternationalWireColombiaSpecificData: {
            legalId: string;
        };
        InternationalWireCorrespondentInfo: {
            bankName?: string | null;
            routingNumber?: string | null;
            swiftCode?: string | null;
        };
        InternationalWireCountrySpecificData: {
            australia?: components["schemas"]["InternationalWireAustraliaSpecificData"] | null;
            brazil?: components["schemas"]["InternationalWireBrazilSpecificData"] | null;
            canada?: components["schemas"]["InternationalWireCanadaSpecificData"] | null;
            chile?: components["schemas"]["InternationalWireChileSpecificData"] | null;
            colombia?: components["schemas"]["InternationalWireColombiaSpecificData"] | null;
            dominicanRepublic?: components["schemas"]["InternationalWireDominicanRepublicSpecificData"] | null;
            honduras?: components["schemas"]["InternationalWireHondurasSpecificData"] | null;
            india?: components["schemas"]["InternationalWireIndiaSpecificData"] | null;
            kazakhstan?: components["schemas"]["InternationalWireKazakhstanSpecificData"] | null;
            pakistan?: components["schemas"]["InternationalWirePakistanSpecificData"] | null;
            paraguay?: components["schemas"]["InternationalWireParaguaySpecificData"] | null;
            philippines?: components["schemas"]["InternationalWirePhilippinesSpecificData"] | null;
            russia?: components["schemas"]["InternationalWireRussiaSpecificData"] | null;
            southAfrica?: components["schemas"]["InternationalWireSouthAfricaSpecificData"] | null;
        };
        InternationalWireDominicanRepublicSpecificData: {
            accountType: components["schemas"]["SwiftBankAccountType"];
            legalId: string;
        };
        InternationalWireHondurasSpecificData: {
            accountType: components["schemas"]["SwiftBankAccountType"];
            legalId: string;
        };
        InternationalWireIndiaSpecificData: {
            ifscCode: string;
        };
        InternationalWireKazakhstanSpecificData: {
            legalId: string;
        };
        InternationalWirePakistanSpecificData: {
            legalId: string;
            legalIdType: components["schemas"]["PakistaniLegalIdType"];
        };
        InternationalWireParaguaySpecificData: {
            legalId: string;
        };
        InternationalWirePhilippinesSpecificData: {
            routingNumber: string;
        };
        InternationalWireRoutingInfo: {
            address?: components["schemas"]["AddressWithoutName"] | null;
            bankDetails?: components["schemas"]["SwiftCodeData"] | null;
            correspondentInfo?: components["schemas"]["InternationalWireCorrespondentInfo"] | null;
            countrySpecific: components["schemas"]["InternationalWireCountrySpecificData"];
            emailAddress?: string | null;
            iban: string;
            phoneNumber?: string | null;
            swiftCode: string;
        };
        InternationalWireRussiaSpecificData: {
            inn: string;
        };
        InternationalWireSouthAfricaSpecificData: {
            branchCode: string;
        };
        /** @description Merchant information for card transactions */
        MerchantData: {
            /**
             * Format: int64
             * @description The transaction amount in the smallest unit of the merchant's currency
             *      (e.g., cents for USD/EUR, yen for JPY, fils for BHD).
             *      For debits this is negative, for credits positive.
             *      Use 'merchantCurrency' to determine the appropriate decimal scaling:
             *      most currencies use 2 decimal places (divide by 100), but JPY uses 0
             *      (no division needed) and BHD/KWD/OMR use 3 (divide by 1000).
             *      This is useful for international transactions where the merchant charges in a
             *      currency different from the account currency. Nothing if not available.
             */
            amount?: number | null;
            category?: (components["schemas"]["MercuryCategory"] & unknown) | null;
            /** @description 4-digit merchant category code (MCC) for card transactions */
            categoryCode?: string | null;
            currency?: (components["schemas"]["CurrencyCode"] & unknown) | null;
            /** @description Merchant ID for card transactions */
            id?: string | null;
        };
        /** @enum {string} */
        MercuryCategory: "Other" | "Advertising" | "Airlines" | "AlcoholAndBars" | "BooksAndNewspaper" | "CarRental" | "Charity" | "Clothing" | "Conferences" | "Education" | "Electronics" | "Entertainment" | "FacilitiesExpenses" | "Fees" | "FoodDelivery" | "FuelAndGas" | "Gambling" | "GovernmentServices" | "Grocery" | "GroundTransportation" | "Insurance" | "InternetAndTelephone" | "Legal" | "Lodging" | "Medical" | "Memberships" | "OfficeSupplies" | "OtherTravel" | "Parking" | "Political" | "ProfessionalServices" | "Restaurants" | "Retail" | "RideshareAndTaxis" | "Shipping" | "Software" | "Taxes" | "Utilities" | "VehicleExpenses";
        /**
         * Format: uuid
         * @description ID for the credit statement period
         */
        MercuryCreditAccountStatementPeriodId: string;
        /** @enum {string} */
        PakistaniLegalIdType: "CNIC" | "SNIC" | "Passport" | "NTN";
        Region: string;
        /** @description A Public API version of RelatedTransactionData. */
        RelatedTransactionData: {
            accountId: components["schemas"]["TransactionPartyId"];
            amount: number;
            id: components["schemas"]["TransactionMetadataId"];
            relationKind: components["schemas"]["TransactionRelationKind"];
        };
        /** @enum {string} */
        SwiftBankAccountType: "checking" | "savings";
        SwiftCodeData: {
            bankCityState: string;
            bankCountry: components["schemas"]["ISO3166Alpha2"];
            bankName: string;
        };
        Transaction: {
            accountId: components["schemas"]["TransactionPartyId"] & unknown;
            amount: number;
            attachments: components["schemas"]["TransactionAttachment"][];
            bankDescription?: string | null;
            /**
             * Format: uuid
             * @description Id of the card behind this transaction, present on card payments and refunds (debit or
             *      credit); null otherwise, including for card-related fee transactions. Fetch the card's details
             *      (kind, cardholder, last four, etc.) via the Cards API (`GET /cards/{cardId}`). Supersedes the
             *      kind-specific `details.creditCardInfo.id` / `details.debitCardInfo.id`.
             */
            cardId?: string | null;
            categoryData?: components["schemas"]["CategoryData"] | null;
            /** @description Present for check deposits and mailed checks; Nothing otherwise. */
            checkNumber?: string | null;
            compliantWithReceiptPolicy: boolean;
            counterpartyId: components["schemas"]["TransactionPartyId"];
            counterpartyName: string;
            counterpartyNickname?: string | null;
            createdAt: components["schemas"]["UTCTime"];
            creditAccountPeriodId?: components["schemas"]["MercuryCreditAccountStatementPeriodId"] | null;
            currencyExchangeInfo?: components["schemas"]["CurrencyExchangeInfo"] | null;
            dashboardLink: string;
            details?: components["schemas"]["TransactionMethodData"] | null;
            estimatedDeliveryDate: components["schemas"]["UTCTime"];
            externalMemo?: string | null;
            failedAt?: components["schemas"]["UTCTime"] | null;
            feeId?: components["schemas"]["TransactionMetadataId"] | null;
            /**
             * @description Deprecated: use transactionGlAllocations instead. This field does not reflect GL codes
             *      assigned via Mercury auto-categorization rules. Preserved for backwards compatibility.
             */
            generalLedgerCodeName?: string | null;
            /**
             * @description GL code allocations assigned to this transaction via a connected accounting software
             *      integration (e.g. QuickBooks, Xero, NetSuite). Each allocation has a GL code name and
             *      the amount allocated to it; amounts sum to the transaction total when the transaction is
             *      fully categorized. Empty if no GL codes have been assigned. Distinct from Mercury custom
             *      categories (see transactionCategoryData).
             */
            glAllocations: components["schemas"]["GlAllocation"][];
            hasGeneratedReceipt: boolean;
            id: components["schemas"]["TransactionMetadataId"];
            kind: components["schemas"]["TransactionKind"];
            merchant?: (components["schemas"]["MerchantData"] & unknown) | null;
            mercuryCategory?: components["schemas"]["MercuryCategory"] | null;
            note?: string | null;
            postedAt?: components["schemas"]["UTCTime"] | null;
            reasonForFailure?: string | null;
            relatedTransactions: components["schemas"]["RelatedTransactionData"][];
            requestId?: string | null;
            status: components["schemas"]["TransactionStatus"];
            /** @description Present for transactions that have tracking numbers (e.g., RTP, ACH, wires); Nothing otherwise. */
            trackingNumber?: string | null;
        };
        TransactionAttachment: {
            attachmentType: components["schemas"]["TransactionAttachmentType"];
            fileName: string;
            url: string;
        };
        /** @enum {string} */
        TransactionAttachmentType: "checkImage" | "receipt" | "other";
        /** @enum {string} */
        TransactionKind: "externalTransfer" | "internalTransfer" | "outgoingPayment" | "creditCardCredit" | "creditCardTransaction" | "debitCardCredit" | "debitCardTransaction" | "cardInternationalTransactionFee" | "cardInternationalTransactionFeeRebate" | "cardInternationalTransactionFeeReversal" | "cardInternationalTransactionFeeRebateReversal" | "incomingDomesticWire" | "checkDeposit" | "incomingInternationalWire" | "treasuryTransfer" | "currencyCloudReturn" | "wireFee" | "personalBankingSubscriptionFee" | "billingEngineSubscriptionFee" | "expenseReimbursement" | "exogenousWireDrawdown" | "interestPayment" | "other";
        /**
         * Format: uuid
         * @description ID for this transaction
         */
        TransactionMetadataId: string;
        TransactionMethodData: {
            address?: components["schemas"]["AddressData"] | null;
            creditCardInfo?: components["schemas"]["CreditCardInfo"] | null;
            debitCardInfo?: components["schemas"]["DebitCardInfo"] | null;
            domesticWireRoutingInfo?: components["schemas"]["DomesticWireRoutingInfo"] | null;
            electronicRoutingInfo?: components["schemas"]["ElectronicRoutingInfo"] | null;
            internationalWireRoutingInfo?: components["schemas"]["InternationalWireRoutingInfo"] | null;
        };
        /** @enum {string} */
        TransactionRelationKind: "ProvisionalCreditReversalToMerchantRefund" | "MerchantRefundToProvisionalCreditReversal" | "MerchantRefundToFraudulentCharge" | "FraudulentChargeToMerchantRefund" | "PaymentRefundToFailedPayment" | "FailedPaymentToPaymentRefund" | "GiftCompensationToOriginalTransaction" | "FeePaymentToOriginalTransaction" | "OriginalTransactionToFeePayment" | "FeePaymentToFeeRebate" | "FeeRebateToFeePayment" | "FeePaymentToFeeReversal" | "FeeReversalToFeePayment" | "FeeRebateToFeeRebateReversal" | "FeeRebateReversalToFeeRebate" | "TreasurySplitLiquidation" | "ProvisionalCreditToOriginalCharge" | "OriginalChargeToProvisionalCredit" | "FeeAtmReimbursementToAtmTransaction" | "AtmTransactionToFeeAtmReimbursement" | "AtmTransactionToAtmReimbursementReversal" | "AtmReimbursementReversalToAtmTransaction" | "ReturnToOriginalTransaction" | "OriginalTransactionToReturn" | "ProvisionalCreditToReversal" | "ReversalToProvisionalCredit" | "MerchantRefundToOriginalCharge" | "OriginalChargeToMerchantRefund";
        /** @enum {string} */
        TransactionStatus: "pending" | "sent" | "cancelled" | "failed" | "reversed" | "blocked";
        TransactionsPaginatedResponse: {
            page: {
                nextPage?: components["schemas"]["UUID"];
                previousPage?: components["schemas"]["UUID"];
            };
            transactions: components["schemas"]["Transaction"][];
        };
        /** @enum {string} */
        USState: "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL" | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME" | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH" | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI" | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY";
        /**
         * Format: uuid
         * @example 00000000-0000-0000-0000-000000000000
         */
        UUID: string;
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getAccounts: {
        parameters: {
            query?: {
                limit?: number;
                order?: "asc" | "desc";
                start_after?: string;
                end_before?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountsPaginatedResponse"];
                };
            };
            /** @description Invalid `end_before` or `start_after` or `order` or `limit` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listTransactions: {
        parameters: {
            query?: {
                status?: ("pending" | "sent" | "cancelled" | "failed" | "reversed" | "blocked")[];
                search?: string;
                start?: string;
                end?: string;
                postedStart?: string;
                postedEnd?: string;
                accountId?: string[];
                cardId?: string[];
                mercuryCategory?: string;
                categoryId?: string;
                start_at?: string;
                start_after?: string;
                end_before?: string;
                limit?: number;
                order?: "asc" | "desc";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionsPaginatedResponse"];
                };
            };
            /** @description Invalid `order` or `limit` or `end_before` or `start_after` or `start_at` or `categoryId` or `mercuryCategory` or `cardId` or `accountId` or `postedEnd` or `postedStart` or `end` or `start` or `search` or `status` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getTransactionById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transactionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Transaction"];
                };
            };
            /** @description `transactionId` not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
