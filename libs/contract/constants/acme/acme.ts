export const ACME_PROVIDER = {
    /**
     * An acme-proxy instance. The panel holds only a scoped client token; the DNS
     * provider credentials stay on the proxy.
     */
    ACME_PROXY: 'ACME_PROXY',
    /**
     * A Cloudflare API token stored in the panel. Simpler, but the panel then
     * holds a credential with edit rights on the whole zone.
     */
    CLOUDFLARE: 'CLOUDFLARE',
    /**
     * No automation: the panel shows the record and waits for it to be published.
     */
    MANUAL: 'MANUAL',
} as const;

export type TAcmeProvider = (typeof ACME_PROVIDER)[keyof typeof ACME_PROVIDER];

export const ACME_PROVIDERS = Object.values(ACME_PROVIDER) as [TAcmeProvider, ...TAcmeProvider[]];

export const ACME_CHALLENGE_TYPE = {
    /**
     * A fresh TXT record per issuance.
     */
    DNS_01: 'DNS_01',
    /**
     * A persistent authorization record bound to the ACME account
     * (draft-ietf-acme-dns-persist). Once published, renewals touch no DNS at all.
     */
    DNS_PERSIST_01: 'DNS_PERSIST_01',
} as const;

export type TAcmeChallengeType = (typeof ACME_CHALLENGE_TYPE)[keyof typeof ACME_CHALLENGE_TYPE];

export const ACME_CHALLENGE_TYPES = Object.values(ACME_CHALLENGE_TYPE) as [
    TAcmeChallengeType,
    ...TAcmeChallengeType[],
];

/** Record name prefixes defined by the ACME challenge specifications. */
export const ACME_RECORD_PREFIX = {
    DNS_01: '_acme-challenge',
    DNS_PERSIST_01: '_validation-persist',
} as const;

export const ACME_KEY_TYPE = {
    ECDSA_P256: 'ECDSA_P256',
    ECDSA_P384: 'ECDSA_P384',
    RSA_2048: 'RSA_2048',
    RSA_4096: 'RSA_4096',
} as const;

export type TAcmeKeyType = (typeof ACME_KEY_TYPE)[keyof typeof ACME_KEY_TYPE];

export const ACME_KEY_TYPES = Object.values(ACME_KEY_TYPE) as [TAcmeKeyType, ...TAcmeKeyType[]];

export const ACME_CERTIFICATE_STATUS = {
    /** Created, never issued yet. */
    PENDING: 'PENDING',
    /** Waiting for a record to be published by hand (MANUAL credentials). */
    AWAITING_DNS: 'AWAITING_DNS',
    /** An order is in flight. */
    ISSUING: 'ISSUING',
    /** A valid certificate is stored. */
    ACTIVE: 'ACTIVE',
    /** The last attempt failed; see lastError and nextRetryAt. */
    ERROR: 'ERROR',
} as const;

export type TAcmeCertificateStatus =
    (typeof ACME_CERTIFICATE_STATUS)[keyof typeof ACME_CERTIFICATE_STATUS];

export const ACME_CERTIFICATE_STATUSES = Object.values(ACME_CERTIFICATE_STATUS) as [
    TAcmeCertificateStatus,
    ...TAcmeCertificateStatus[],
];

/**
 * Known ACME directories, staging endpoints included.
 *
 * Staging is not a curiosity here: it is the only place to rehearse a new
 * certificate without spending the production rate limit, and — as of 2026-08 —
 * the only place where dns-persist-01 works at all.
 */
export const ACME_DIRECTORY = {
    LETSENCRYPT: 'https://acme-v02.api.letsencrypt.org/directory',
    LETSENCRYPT_STAGING: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    BUYPASS: 'https://api.buypass.com/acme/directory',
    BUYPASS_STAGING: 'https://api.test4.buypass.no/acme/directory',
    GOOGLE: 'https://dv.acme-v02.api.pki.goog/directory',
    GOOGLE_STAGING: 'https://dv.acme-v02.test-api.pki.goog/directory',
    ZEROSSL: 'https://acme.zerossl.com/v2/DV90',
} as const;

export type TAcmeDirectory = (typeof ACME_DIRECTORY)[keyof typeof ACME_DIRECTORY];

export interface IAcmeDirectoryPreset {
    name: string;
    url: string;
    isStaging: boolean;
    /** External Account Binding is mandatory for this CA. */
    requiresEab: boolean;
}

export const ACME_DIRECTORY_PRESETS: IAcmeDirectoryPreset[] = [
    {
        name: "Let's Encrypt",
        url: ACME_DIRECTORY.LETSENCRYPT,
        isStaging: false,
        requiresEab: false,
    },
    {
        name: "Let's Encrypt (staging)",
        url: ACME_DIRECTORY.LETSENCRYPT_STAGING,
        isStaging: true,
        requiresEab: false,
    },
    {
        name: 'Buypass Go',
        url: ACME_DIRECTORY.BUYPASS,
        isStaging: false,
        requiresEab: false,
    },
    {
        name: 'Buypass Go (staging)',
        url: ACME_DIRECTORY.BUYPASS_STAGING,
        isStaging: true,
        requiresEab: false,
    },
    {
        name: 'Google Trust Services',
        url: ACME_DIRECTORY.GOOGLE,
        isStaging: false,
        requiresEab: true,
    },
    {
        name: 'Google Trust Services (staging)',
        url: ACME_DIRECTORY.GOOGLE_STAGING,
        isStaging: true,
        requiresEab: true,
    },
    {
        name: 'ZeroSSL',
        url: ACME_DIRECTORY.ZEROSSL,
        isStaging: false,
        requiresEab: true,
    },
];

export const ACME_EVENT_LEVEL = {
    INFO: 'INFO',
    ERROR: 'ERROR',
} as const;

export type TAcmeEventLevel = (typeof ACME_EVENT_LEVEL)[keyof typeof ACME_EVENT_LEVEL];

export const ACME_EVENT_LEVELS = Object.values(ACME_EVENT_LEVEL) as [
    TAcmeEventLevel,
    ...TAcmeEventLevel[],
];
