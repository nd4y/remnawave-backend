import { Injectable, Logger } from '@nestjs/common';

import { fail, ok, TResult } from '@common/types';
import { ACME_PROVIDER, ERRORS, TAcmeProvider } from '@libs/contracts/constants';

import { CreateAcmeCredentialBodyDto, UpdateAcmeCredentialBodyDto } from '../dtos';
import { AcmeCredentialEntity } from '../entities';
import {
    IAcmeProxyCredentialPayload,
    ICloudflareCredentialPayload,
    TAcmeCredentialPayload,
} from '../interfaces/credential-payload.interface';
import {
    AcmeCredentialResponseModel,
    AcmeCredentialTestResponseModel,
    GetAcmeCredentialsResponseModel,
} from '../models';
import { AcmeSecretBoxService } from '../crypto/acme-secret-box.service';
import { SolverFactory } from '../engine/solvers/solver.factory';
import { AcmeCredentialsRepository } from '../repositories/acme-credentials.repository';

@Injectable()
export class AcmeCredentialsService {
    private readonly logger = new Logger(AcmeCredentialsService.name);

    constructor(
        private readonly credentialsRepository: AcmeCredentialsRepository,
        private readonly secretBox: AcmeSecretBoxService,
        private readonly solverFactory: SolverFactory,
    ) {}

    public async getAll(): Promise<TResult<GetAcmeCredentialsResponseModel>> {
        try {
            const credentials = await this.credentialsRepository.findAll();

            return ok(
                new GetAcmeCredentialsResponseModel(
                    credentials.map((credential) => this.toResponse(credential)),
                ),
            );
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_ACME_CREDENTIALS_ERROR);
        }
    }

    public async create(
        dto: CreateAcmeCredentialBodyDto,
    ): Promise<TResult<AcmeCredentialResponseModel>> {
        if (!this.secretBox.isConfigured) {
            return fail(ERRORS.ACME_SECRET_KEY_MISSING);
        }

        try {
            const existing = await this.credentialsRepository.findByName(dto.name);

            if (existing) {
                return fail(ERRORS.ACME_CREDENTIAL_NAME_ALREADY_EXISTS);
            }

            const payload = this.buildPayload(dto.provider, dto);

            const credential = await this.credentialsRepository.create({
                name: dto.name,
                provider: dto.provider,
                payloadEncrypted: payload ? this.secretBox.encryptJson(payload) : null,
            });

            return ok(this.toResponse(credential));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.CREATE_ACME_CREDENTIAL_ERROR);
        }
    }

    public async update(
        dto: UpdateAcmeCredentialBodyDto,
    ): Promise<TResult<AcmeCredentialResponseModel>> {
        if (!this.secretBox.isConfigured) {
            return fail(ERRORS.ACME_SECRET_KEY_MISSING);
        }

        try {
            const credential = await this.credentialsRepository.findByUUID(dto.uuid);

            if (!credential) {
                return fail(ERRORS.ACME_CREDENTIAL_NOT_FOUND);
            }

            if (dto.name && dto.name !== credential.name) {
                const sameName = await this.credentialsRepository.findByName(dto.name);

                if (sameName) {
                    return fail(ERRORS.ACME_CREDENTIAL_NAME_ALREADY_EXISTS);
                }
            }

            // Secrets are write-only: a request that omits them keeps whatever is
            // stored, and a partial update merges into the existing payload so
            // changing only the base URL does not wipe the token.
            const current = this.readPayload(credential);
            const merged = this.mergePayload(credential.provider, current, dto);

            const updated = await this.credentialsRepository.update(dto.uuid, {
                ...(dto.name ? { name: dto.name } : {}),
                ...(merged ? { payloadEncrypted: this.secretBox.encryptJson(merged) } : {}),
            });

            return ok(this.toResponse(updated));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.UPDATE_ACME_CREDENTIAL_ERROR);
        }
    }

    public async delete(uuid: string): Promise<TResult<{ isDeleted: boolean }>> {
        try {
            const credential = await this.credentialsRepository.findByUUID(uuid);

            if (!credential) {
                return fail(ERRORS.ACME_CREDENTIAL_NOT_FOUND);
            }

            // Deleting a credential a certificate still points at would leave that
            // certificate unable to renew, and the failure would only surface weeks
            // later. Refuse instead.
            if (credential.certificatesCount > 0) {
                return fail(ERRORS.ACME_CREDENTIAL_IN_USE);
            }

            const isDeleted = await this.credentialsRepository.deleteByUUID(uuid);

            return ok({ isDeleted });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.DELETE_ACME_CREDENTIAL_ERROR);
        }
    }

    /**
     * Checks that the credential actually works and reports what it may do.
     *
     * For acme-proxy this is the only way an operator sees the allow list without
     * shell access to the proxy host — which is exactly when a certificate fails
     * with "domain is not allowed" and nobody remembers what was configured.
     */
    public async test(uuid: string): Promise<TResult<AcmeCredentialTestResponseModel>> {
        if (!this.secretBox.isConfigured) {
            return fail(ERRORS.ACME_SECRET_KEY_MISSING);
        }

        try {
            const credential = await this.credentialsRepository.findByUUID(uuid);

            if (!credential) {
                return fail(ERRORS.ACME_CREDENTIAL_NOT_FOUND);
            }

            const solver = this.solverFactory.create(credential);
            const description = await solver.describe();

            return ok(new AcmeCredentialTestResponseModel(description));
        } catch (error) {
            this.logger.error(error);

            return fail(ERRORS.ACME_CREDENTIAL_TEST_FAILED.withMessage(String(error)));
        }
    }

    /** Decrypted payload of a credential, or null when there is nothing stored. */
    public readPayload(credential: AcmeCredentialEntity): null | TAcmeCredentialPayload {
        if (!credential.payloadEncrypted) {
            return null;
        }

        return this.secretBox.decryptJson<TAcmeCredentialPayload>(credential.payloadEncrypted);
    }

    public toResponse(credential: AcmeCredentialEntity): AcmeCredentialResponseModel {
        return new AcmeCredentialResponseModel(credential, this.readBaseUrl(credential));
    }

    private readBaseUrl(credential: AcmeCredentialEntity): null | string {
        if (credential.provider !== ACME_PROVIDER.ACME_PROXY || !credential.payloadEncrypted) {
            return null;
        }

        try {
            const payload = this.secretBox.decryptJson<IAcmeProxyCredentialPayload>(
                credential.payloadEncrypted,
            );

            return payload.baseUrl ?? null;
        } catch (error) {
            // A payload that cannot be decrypted usually means ACME_SECRET_KEY was
            // replaced. Listing credentials should still work so the operator can
            // see and fix them.
            this.logger.error(`Failed to read credential ${credential.uuid} payload: ${error}`);

            return null;
        }
    }

    private buildPayload(
        provider: TAcmeProvider,
        dto: Pick<CreateAcmeCredentialBodyDto, 'apiToken' | 'baseUrl' | 'token'>,
    ): null | TAcmeCredentialPayload {
        switch (provider) {
            case ACME_PROVIDER.ACME_PROXY:
                return {
                    baseUrl: dto.baseUrl!.replace(/\/+$/, ''),
                    token: dto.token!,
                } satisfies IAcmeProxyCredentialPayload;
            case ACME_PROVIDER.CLOUDFLARE:
                return { apiToken: dto.apiToken! } satisfies ICloudflareCredentialPayload;
            default:
                return null;
        }
    }

    private mergePayload(
        provider: TAcmeProvider,
        current: null | TAcmeCredentialPayload,
        dto: UpdateAcmeCredentialBodyDto,
    ): null | TAcmeCredentialPayload {
        switch (provider) {
            case ACME_PROVIDER.ACME_PROXY: {
                const existing = (current ?? {}) as Partial<IAcmeProxyCredentialPayload>;

                if (!dto.baseUrl && !dto.token) {
                    return null;
                }

                return {
                    baseUrl: (dto.baseUrl ?? existing.baseUrl ?? '').replace(/\/+$/, ''),
                    token: dto.token ?? existing.token ?? '',
                } satisfies IAcmeProxyCredentialPayload;
            }
            case ACME_PROVIDER.CLOUDFLARE: {
                if (!dto.apiToken) {
                    return null;
                }

                return { apiToken: dto.apiToken } satisfies ICloudflareCredentialPayload;
            }
            default:
                return null;
        }
    }
}
