/**
 * What is stored, encrypted, in acme_credentials.payload_encrypted. The shape
 * depends on the provider; MANUAL stores nothing.
 */

export interface IAcmeProxyCredentialPayload {
    baseUrl: string;
    token: string;
}

export interface ICloudflareCredentialPayload {
    apiToken: string;
}

export type TAcmeCredentialPayload =
    | IAcmeProxyCredentialPayload
    | ICloudflareCredentialPayload
    | Record<string, never>;
