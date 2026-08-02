import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { Injectable, Logger } from '@nestjs/common';

import { fail, ok, TResult } from '@common/types';
import { ACME_CERTIFICATE_STATUS, ACME_CHALLENGE_TYPE, ERRORS } from '@libs/contracts/constants';

import { AcmeQueueService } from '@queue/_acme';

import { CreateAcmeCertificateBodyDto, UpdateAcmeCertificateBodyDto } from '../dtos';
import {
    AcmeCertificateResponseModel,
    AcmeEventResponseModel,
    AcmePersistRecordResponseModel,
    GetAcmeCertificateEventsResponseModel,
    GetAcmeCertificatesResponseModel,
} from '../models';
import { AcmeSecretBoxService } from '../crypto/acme-secret-box.service';
import { AcmeOrderService } from '../engine/acme-order.service';
import { isTxtValuePublished } from '../engine/dns-propagation.util';
import {
    buildPersistRecordName,
    buildPersistRecordValue,
    resolveIssuerDomain,
} from '../engine/persist-record.util';
import { SolverFactory } from '../engine/solvers/solver.factory';
import { AcmeCertificatesRepository } from '../repositories/acme-certificates.repository';
import { AcmeCredentialsRepository } from '../repositories/acme-credentials.repository';
import { AcmeEventsRepository } from '../repositories/acme-events.repository';

/** Changes that make the stored certificate no longer match what was asked for. */
const REISSUE_TRIGGERS = ['domains', 'keyType', 'challengeType', 'directoryUrl'] as const;

@Injectable()
export class AcmeCertificatesService {
    private readonly logger = new Logger(AcmeCertificatesService.name);

    constructor(
        private readonly certificatesRepository: AcmeCertificatesRepository,
        private readonly credentialsRepository: AcmeCredentialsRepository,
        private readonly eventsRepository: AcmeEventsRepository,
        private readonly secretBox: AcmeSecretBoxService,
        private readonly solverFactory: SolverFactory,
        private readonly acmeOrderService: AcmeOrderService,
        private readonly acmeQueueService: AcmeQueueService,
    ) {}

    public async getAll(): Promise<TResult<GetAcmeCertificatesResponseModel>> {
        try {
            const certificates = await this.certificatesRepository.findAll();

            return ok(
                new GetAcmeCertificatesResponseModel(
                    certificates.map(
                        (certificate) => new AcmeCertificateResponseModel(certificate),
                    ),
                ),
            );
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_ACME_CERTIFICATES_ERROR);
        }
    }

    public async getByUuid(uuid: string): Promise<TResult<AcmeCertificateResponseModel>> {
        try {
            const certificate = await this.certificatesRepository.findByUUID(uuid);

            if (!certificate) {
                return fail(ERRORS.ACME_CERTIFICATE_NOT_FOUND);
            }

            return ok(new AcmeCertificateResponseModel(certificate));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_ACME_CERTIFICATES_ERROR);
        }
    }

    public async create(
        dto: CreateAcmeCertificateBodyDto,
    ): Promise<TResult<AcmeCertificateResponseModel>> {
        if (!this.secretBox.isConfigured) {
            return fail(ERRORS.ACME_SECRET_KEY_MISSING);
        }

        try {
            const existing = await this.certificatesRepository.findByName(dto.name);

            if (existing) {
                return fail(ERRORS.ACME_CERTIFICATE_NAME_ALREADY_EXISTS);
            }

            const credential = await this.credentialsRepository.findByUUID(dto.credentialUuid);

            if (!credential) {
                return fail(ERRORS.ACME_CREDENTIAL_NOT_FOUND);
            }

            const certificate = await this.certificatesRepository.create(
                {
                    name: dto.name,
                    domains: dto.domains,
                    challengeType: dto.challengeType,
                    keyType: dto.keyType,
                    renewBeforeDays: dto.renewBeforeDays,
                    isEnabled: dto.isEnabled,
                    directoryUrl: dto.directoryUrl,
                    email: dto.email,
                    eabKid: dto.eabKid ?? null,
                    credentialUuid: dto.credentialUuid,
                },
                dto.nodes,
            );

            await this.eventsRepository.create(
                certificate.uuid,
                'INFO',
                `Certificate created for ${dto.domains.join(', ')}`,
            );

            return ok(new AcmeCertificateResponseModel(certificate));
        } catch (error) {
            if (error instanceof PrismaClientKnownRequestError && error.code === 'P2003') {
                return fail(
                    ERRORS.ACME_INVALID_CERTIFICATE_REQUEST.withMessage(
                        'One of the nodes does not exist',
                    ),
                );
            }

            this.logger.error(error);
            return fail(ERRORS.CREATE_ACME_CERTIFICATE_ERROR);
        }
    }

    public async update(
        dto: UpdateAcmeCertificateBodyDto,
    ): Promise<TResult<AcmeCertificateResponseModel>> {
        if (!this.secretBox.isConfigured) {
            return fail(ERRORS.ACME_SECRET_KEY_MISSING);
        }

        try {
            const certificate = await this.certificatesRepository.findByUUID(dto.uuid);

            if (!certificate) {
                return fail(ERRORS.ACME_CERTIFICATE_NOT_FOUND);
            }

            if (dto.name && dto.name !== certificate.name) {
                const sameName = await this.certificatesRepository.findByName(dto.name);

                if (sameName) {
                    return fail(ERRORS.ACME_CERTIFICATE_NAME_ALREADY_EXISTS);
                }
            }

            if (dto.credentialUuid) {
                const credential = await this.credentialsRepository.findByUUID(dto.credentialUuid);

                if (!credential) {
                    return fail(ERRORS.ACME_CREDENTIAL_NOT_FOUND);
                }
            }

            const needsReissue = this.needsReissue(certificate, dto);

            const updated = await this.certificatesRepository.update(
                dto.uuid,
                {
                    ...(dto.name === undefined ? {} : { name: dto.name }),
                    ...(dto.domains === undefined ? {} : { domains: dto.domains }),
                    ...(dto.challengeType === undefined
                        ? {}
                        : { challengeType: dto.challengeType }),
                    ...(dto.keyType === undefined ? {} : { keyType: dto.keyType }),
                    ...(dto.renewBeforeDays === undefined
                        ? {}
                        : { renewBeforeDays: dto.renewBeforeDays }),
                    ...(dto.isEnabled === undefined ? {} : { isEnabled: dto.isEnabled }),
                    ...(dto.directoryUrl === undefined ? {} : { directoryUrl: dto.directoryUrl }),
                    ...(dto.email === undefined ? {} : { email: dto.email }),
                    ...(dto.eabKid === undefined ? {} : { eabKid: dto.eabKid }),
                    ...(dto.credentialUuid === undefined
                        ? {}
                        : { credentialUuid: dto.credentialUuid }),
                },
                dto.nodes,
            );

            if (needsReissue) {
                // The stored certificate no longer matches the request, so it is
                // marked stale rather than deleted: the node keeps serving the old
                // one until a new one actually arrives.
                await this.certificatesRepository.updateResult(dto.uuid, {
                    status: ACME_CERTIFICATE_STATUS.PENDING,
                    nextRetryAt: null,
                    failCount: 0,
                });

                await this.eventsRepository.create(
                    dto.uuid,
                    'INFO',
                    'Certificate parameters changed, re-issue scheduled',
                );

                const refreshed = await this.certificatesRepository.findByUUID(dto.uuid);

                return ok(new AcmeCertificateResponseModel(refreshed ?? updated));
            }

            return ok(new AcmeCertificateResponseModel(updated));
        } catch (error) {
            if (error instanceof PrismaClientKnownRequestError && error.code === 'P2003') {
                return fail(
                    ERRORS.ACME_INVALID_CERTIFICATE_REQUEST.withMessage(
                        'One of the nodes does not exist',
                    ),
                );
            }

            this.logger.error(error);
            return fail(ERRORS.UPDATE_ACME_CERTIFICATE_ERROR);
        }
    }

    public async delete(uuid: string): Promise<TResult<{ isDeleted: boolean }>> {
        try {
            const certificate = await this.certificatesRepository.findByUUID(uuid);

            if (!certificate) {
                return fail(ERRORS.ACME_CERTIFICATE_NOT_FOUND);
            }

            const isDeleted = await this.certificatesRepository.deleteByUUID(uuid);

            return ok({ isDeleted });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.DELETE_ACME_CERTIFICATE_ERROR);
        }
    }

    public async getEvents(
        uuid: string,
    ): Promise<TResult<GetAcmeCertificateEventsResponseModel>> {
        try {
            const certificate = await this.certificatesRepository.findByUUID(uuid);

            if (!certificate) {
                return fail(ERRORS.ACME_CERTIFICATE_NOT_FOUND);
            }

            const events = await this.eventsRepository.findByCertificateUuid(uuid);

            return ok(
                new GetAcmeCertificateEventsResponseModel(
                    events.map((event) => new AcmeEventResponseModel(event)),
                ),
            );
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_ACME_CERTIFICATES_ERROR);
        }
    }

    /**
     * Queues an order. It is not awaited: an order takes tens of seconds, and the
     * certificate's status and events are where progress belongs.
     */
    public async issue(uuid: string): Promise<TResult<{ isQueued: boolean }>> {
        if (!this.secretBox.isConfigured) {
            return fail(ERRORS.ACME_SECRET_KEY_MISSING);
        }

        try {
            const certificate = await this.certificatesRepository.findByUUID(uuid);

            if (!certificate) {
                return fail(ERRORS.ACME_CERTIFICATE_NOT_FOUND);
            }

            // A manual run clears the backoff: the operator is presumably fixing
            // whatever was broken and should not wait out the previous penalty.
            await this.certificatesRepository.updateResult(uuid, { nextRetryAt: null });

            await this.acmeQueueService.issueCertificate({
                certificateUuid: uuid,
                force: true,
            });

            await this.eventsRepository.create(uuid, 'INFO', 'Issuance requested manually');

            return ok({ isQueued: true });
        } catch (error) {
            this.logger.error(error);

            return fail(ERRORS.ACME_CERTIFICATE_ISSUE_ERROR.withMessage(String(error)));
        }
    }

    /**
     * The persistent authorization record for a dns-persist-01 certificate.
     *
     * Building it needs the ACME account URI, so the account is registered on
     * first call — the record cannot be shown before the CA knows the account it
     * points at.
     */
    public async getPersistRecord(
        uuid: string,
        publish = false,
    ): Promise<TResult<AcmePersistRecordResponseModel>> {
        if (!this.secretBox.isConfigured) {
            return fail(ERRORS.ACME_SECRET_KEY_MISSING);
        }

        try {
            const certificate = await this.certificatesRepository.findByUUID(uuid);

            if (!certificate) {
                return fail(ERRORS.ACME_CERTIFICATE_NOT_FOUND);
            }

            if (certificate.challengeType !== ACME_CHALLENGE_TYPE.DNS_PERSIST_01) {
                return fail(ERRORS.ACME_PERSIST_RECORD_NOT_APPLICABLE);
            }

            const credential = certificate.credentialUuid
                ? await this.credentialsRepository.findByUUID(certificate.credentialUuid)
                : null;

            if (!credential) {
                return fail(ERRORS.ACME_CREDENTIAL_NOT_FOUND);
            }

            const { account } = await this.acmeOrderService.buildClient(certificate);

            const name = buildPersistRecordName(certificate.domains);
            const value = buildPersistRecordValue(
                resolveIssuerDomain(certificate.directoryUrl),
                account.accountUrl!,
                certificate.domains,
            );

            const solver = this.solverFactory.create(credential);

            if (publish) {
                if (!solver.canPublish) {
                    return fail(
                        ERRORS.ACME_SOLVER_ERROR.withMessage(
                            `Credential "${credential.name}" cannot publish records. Add the record to your DNS zone manually.`,
                        ),
                    );
                }

                await solver.publishPersist(name, value);

                await this.eventsRepository.create(
                    uuid,
                    'INFO',
                    `Published the persistent authorization record ${name}`,
                );
            }

            return ok(
                new AcmePersistRecordResponseModel({
                    name,
                    value,
                    isPublished: await isTxtValuePublished(name, value),
                    canPublish: solver.canPublish,
                }),
            );
        } catch (error) {
            this.logger.error(error);

            return fail(ERRORS.ACME_SOLVER_ERROR.withMessage(String(error)));
        }
    }

    private needsReissue(
        certificate: { challengeType: string; directoryUrl: string; domains: string[]; keyType: string },
        dto: UpdateAcmeCertificateBodyDto,
    ): boolean {
        return REISSUE_TRIGGERS.some((field) => {
            const next = dto[field];

            if (next === undefined) {
                return false;
            }

            if (field === 'domains') {
                const current = [...certificate.domains].sort();
                const requested = [...(next as string[])].sort();

                return JSON.stringify(current) !== JSON.stringify(requested);
            }

            return next !== certificate[field];
        });
    }
}
