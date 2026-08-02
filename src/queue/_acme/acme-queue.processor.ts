import { Job } from 'bullmq';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { IssueCertificateCommand } from '@modules/acme/commands/issue-certificate';

import { QUEUES_NAMES } from '../queue.enum';
import { ACME_JOB_NAMES } from './constants';

@Processor(QUEUES_NAMES.ACME.ISSUE, {
    concurrency: 1,
})
export class AcmeQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(AcmeQueueProcessor.name);

    constructor(private readonly commandBus: CommandBus) {
        super();
    }

    async process(job: Job) {
        switch (job.name) {
            case ACME_JOB_NAMES.ISSUE_CERTIFICATE:
                return await this.handleIssueCertificate(job);

            default:
                this.logger.warn(`Job "${job.name}" is not handled.`);
                break;
        }
    }

    private async handleIssueCertificate(job: Job) {
        const { certificateUuid, force } = job.data as {
            certificateUuid: string;
            force?: boolean;
        };

        // The order records its own outcome on the certificate, so a failure here
        // is logged and swallowed: throwing would only add a BullMQ retry on top
        // of the backoff the engine already applied.
        const result = await this.commandBus.execute(
            new IssueCertificateCommand(certificateUuid, force ?? false),
        );

        if (!result.isOk) {
            this.logger.error(`Issuance job failed: ${result.message}`);

            return;
        }

        this.logger.log(result.response.message);
    }
}
