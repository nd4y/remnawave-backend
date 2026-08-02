import { TAcmeProvider } from '@libs/contracts/constants';

import { AcmeCredentialEntity } from '../entities';

/**
 * Credentials as seen from outside. The stored secret never appears here — only
 * whether one is set, plus the non-secret base URL of an acme-proxy so the UI can
 * show which proxy a credential points at.
 */
export class AcmeCredentialResponseModel {
    public uuid: string;
    public name: string;
    public provider: TAcmeProvider;
    public hasSecret: boolean;
    public baseUrl: null | string;
    public certificatesCount: number;
    public createdAt: Date;
    public updatedAt: Date;

    constructor(entity: AcmeCredentialEntity, baseUrl: null | string) {
        this.uuid = entity.uuid;
        this.name = entity.name;
        this.provider = entity.provider;
        this.hasSecret = entity.payloadEncrypted !== null;
        this.baseUrl = baseUrl;
        this.certificatesCount = entity.certificatesCount;
        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
    }
}

export class GetAcmeCredentialsResponseModel {
    public total: number;
    public credentials: AcmeCredentialResponseModel[];

    constructor(credentials: AcmeCredentialResponseModel[]) {
        this.credentials = credentials;
        this.total = credentials.length;
    }
}
