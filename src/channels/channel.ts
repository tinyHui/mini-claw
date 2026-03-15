// MessageCallback is invoked by a Channel implementation whenever a new user
// message arrives. channelId is the routing identifier (e.g. Telegram chat ID).
// userId identifies who sent the message. The orchestration layer (index.ts)
// resolves the user's session and drives the full AI workflow.
export type MessageCallback = (
	channelId: string,
	userId: string,
	platformMsgId: string,
	content: string,
) => Promise<void>;

export type DeliveryStatus = "ACK" | "processed";

// MessageSentCallback is invoked by the channel after sendAckMessage or
// updateOrSendMessage completes. sessionId is the DB session UUID threaded
// through by the channel. Use this to persist the delivered content to
// the database without duplicating the same arguments at the call site.
export type MessageSentCallback = (
	sessionId: string,
	platformMsgId: string,
	content: string,
	status: DeliveryStatus,
) => Promise<void>;

// Channel abstracts any messaging platform (Telegram, Discord, CLI, …).
// channelId is the platform routing identifier (where to send messages).
// sessionId is the DB session UUID (threaded through for DB callbacks).
export interface Channel {
	onMessage(callback: MessageCallback): void;

	onMessageSent(callback: MessageSentCallback): void;

	// Send an initial acknowledgement and return the platform message ID.
	// channelId routes the message; sessionId is passed through to the
	// onMessageSent callback for DB persistence.
	sendAckMessage(
		channelId: string,
		sessionId: string,
		content: string,
	): Promise<string | undefined>;

	// Deliver content to the user via channelId. sessionId is threaded
	// through to the onMessageSent callback.
	updateOrSendMessage(
		channelId: string,
		sessionId: string,
		content: string,
		platformMsgId?: string,
		status?: DeliveryStatus,
	): Promise<void>;

	start(): Promise<void>;

	stop(): void;
}
