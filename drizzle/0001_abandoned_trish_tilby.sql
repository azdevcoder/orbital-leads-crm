CREATE TABLE `contact_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(128) NOT NULL,
	`leadId` int NOT NULL,
	`channel` varchar(48) NOT NULL,
	`details` text,
	`contactedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contact_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(128) NOT NULL,
	`leadId` int NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(128) NOT NULL,
	`placeId` varchar(255),
	`name` varchar(255) NOT NULL,
	`phone` varchar(64),
	`fullAddress` text,
	`website` varchar(512),
	`rating` decimal(3,1),
	`businessStatus` varchar(32) NOT NULL DEFAULT 'Aberto',
	`status` enum('Novo','Contatado','Em Negociação','Fechado','Perdido') NOT NULL DEFAULT 'Novo',
	`segment` varchar(160) NOT NULL,
	`city` varchar(160) NOT NULL,
	`state` varchar(8) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `leads_tenant_place_unique` UNIQUE(`tenantId`,`placeId`)
);
--> statement-breakpoint
CREATE TABLE `searches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(128) NOT NULL,
	`segment` varchar(160) NOT NULL,
	`city` varchar(160) NOT NULL,
	`state` varchar(8) NOT NULL,
	`resultCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `searches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `name` varchar(160) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `loginMethod` varchar(64) NOT NULL DEFAULT 'email';--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
CREATE INDEX `contact_logs_tenant_lead_idx` ON `contact_logs` (`tenantId`,`leadId`);--> statement-breakpoint
CREATE INDEX `lead_notes_tenant_lead_idx` ON `lead_notes` (`tenantId`,`leadId`);--> statement-breakpoint
CREATE INDEX `leads_tenant_idx` ON `leads` (`tenantId`);--> statement-breakpoint
CREATE INDEX `leads_tenant_status_idx` ON `leads` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `leads_tenant_city_idx` ON `leads` (`tenantId`,`city`);--> statement-breakpoint
CREATE INDEX `searches_tenant_created_idx` ON `searches` (`tenantId`,`createdAt`);