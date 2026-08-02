import { X509Certificate } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { AcmeSecretBoxService } from '../../crypto/acme-secret-box.service';
import { AcmeCertificatesRepository } from '../../repositories/acme-certificates.repository';
import {
    GetCertificatesForNodeQuery,
    INodeCertificate,
} from './get-certificates-for-node.query';

@QueryHandler(GetCertificatesForNodeQuery)
export class GetCertificatesForNodeHandler
    implements IQueryHandler<GetCertificatesForNodeQuery, TResult<INodeCertificate[]>>
{
    private readonly logger = new Logger(GetCertificatesForNodeHandler.name);

    constructor(
        private readonly certificatesRepository: AcmeCertificatesRepository,
        private readonly secretBox: AcmeSecretBoxService,
    ) {}

    async execute(query: GetCertificatesForNodeQuery): Promise<TResult<INodeCertificate[]>> {
        try {
            if (!this.secretBox.isConfigured) {
                return ok([]);
            }

            const certificates = await this.certificatesRepository.findActiveByNodeUuid(
                query.nodeUuid,
            );

            const result: INodeCertificate[] = [];

            for (const certificate of certificates) {
                if (!certificate.fullchainPem || !certificate.keyEncrypted) {
                    continue;
                }

                const binding = certificate.nodes.find(
                    (candidate) => candidate.nodeUuid === query.nodeUuid,
                );

                try {
                    result.push({
                        commonName: new X509Certificate(certificate.fullchainPem).subject
                            .split('\n')
                            .map((line) => line.trim())
                            .find((line) => line.startsWith('CN='))
                            ?.slice(3) ?? certificate.domains[0],
                        certificate: toPemLines(certificate.fullchainPem),
                        key: toPemLines(this.secretBox.decrypt(certificate.keyEncrypted)),
                        fingerprint: certificate.fingerprint ?? '',
                        inboundTags: binding?.inboundTags ?? [],
                    });
                } catch (error) {
                    // One unreadable certificate — a key encrypted with a previous
                    // ACME_SECRET_KEY, say — must not stop the node from starting
                    // with the rest of its configuration.
                    this.logger.error(
                        `Skipping certificate ${certificate.name} for node ${query.nodeUuid}: ${error}`,
                    );
                }
            }

            return ok(result);
        } catch (error) {
            this.logger.error(error);

            return fail(ERRORS.GET_ACME_CERTIFICATES_ERROR);
        }
    }
}

/** Xray takes inline certificates as an array of lines, blank ones dropped. */
function toPemLines(pem: string): string[] {
    return pem
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((line) => line.length > 0);
}
