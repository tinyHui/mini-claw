CREATE TABLE `messages` (
	`id` text NOT NULL,
	`sessionId` text NOT NULL,
	`timeStamp` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	PRIMARY KEY(`id`, `sessionId`),
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` text NOT NULL,
	`model` text NOT NULL,
	`thinkingLevel` text NOT NULL
);
