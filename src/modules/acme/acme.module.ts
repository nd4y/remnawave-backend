import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AcmeCertificatesController } from './acme-certificates.controller';
import { AcmeCredentialsController } from './acme-credentials.controller';
import { AcmeSecretBoxService } from './crypto/acme-secret-box.service';
import { AcmeAccountsRepository } from './repositories/acme-accounts.repository';
import { AcmeCertificatesRepository } from './repositories/acme-certificates.repository';
import { AcmeCredentialsRepository } from './repositories/acme-credentials.repository';
import { AcmeEventsRepository } from './repositories/acme-events.repository';
import { AcmeCertificatesService } from './services/acme-certificates.service';
import { AcmeCredentialsService } from './services/acme-credentials.service';

@Module({
    imports: [CqrsModule],
    controllers: [AcmeCredentialsController, AcmeCertificatesController],
    providers: [
        AcmeSecretBoxService,
        AcmeCredentialsService,
        AcmeCertificatesService,
        AcmeCredentialsRepository,
        AcmeCertificatesRepository,
        AcmeAccountsRepository,
        AcmeEventsRepository,
    ],
    exports: [AcmeSecretBoxService, AcmeCertificatesRepository, AcmeCredentialsService],
})
export class AcmeModule {}
