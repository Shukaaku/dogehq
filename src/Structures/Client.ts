import { raw, wrap, Wrapper, InvitationToRoomResponse, http } from '@dogehouse/kebab';
import { TypedEventEmitter } from '../Util/TypedEmitter';
import { baseUrl } from '../Util/Constants';
import { Collection } from './Collection';
import { ClientUser } from './ClientUser';
import { Message } from './Message';
import EventEmitter from 'eventemitter3';
import { Room } from './Room';
import { User } from './User';

export interface CreateBotResponse {
	apiKey: string | null;
	isUsernameTaken: boolean | null;
	error: string | null;
}

export interface BotCredentials {
	accessToken: string;
	refreshToken: string;
	username: string;
}

export interface ClientEvents {
	ready: () => void;
	userJoin: (user?: User) => void;
	message: (message: Message) => void;
	userLeave: (user?: User, room?: Room) => void;
	handRaised: (user?: User) => void;
	invite: (invite: InvitationToRoomResponse) => void;
	joinRoom: (room: Room) => void;
	leaveRoom: (room: Room) => void;
}

/**
 * The main client class.
 * @extends {EventEmitter}
 * @example ```js
 * const { Client } = require('dogehq');
 * const client = new Client();
 *
 * client.on('ready', () => console.log('Im ready!'));
 *
 * client.login('token', 'accessToken');
 * ```
 */
export class Client extends ((EventEmitter as any) as new () => TypedEventEmitter<ClientEvents>) {
	/**
	 * The timeouts.
	 * @type {Set<NodeJS.Timeout>}
	 */
	private readonly _timeouts = new Set<NodeJS.Timeout>();

	/**
	 * The intervals.
	 * @type {Set<NodeJS.Timeout>}
	 */
	private readonly _intervals = new Set<NodeJS.Timeout>();

	/**
	 * The immediates.
	 * @type {Set<NodeJS.Immediate>}
	 */
	private readonly _immediates = new Set<NodeJS.Immediate>();

	/**
	 * The raw connection.
	 * @type {raw.Connection}
	 */
	public connection!: raw.Connection;

	/**
	 * The wrapper.
	 * @type {Wrapper}
	 */
	public wrapper!: Wrapper;

	/**
	 * The top public rooms.
	 * @type {Collection<string, Room>}
	 */
	public rooms!: Collection<string, Room>;

	/**
	 * The users.
	 * @type {Collection<string, User>}
	 */
	public users!: Collection<string, User>;

	/**
	 * The token that you used to auth.
	 * @type {?string}
	 */
	public token!: string | null;

	/**
	 * The refresh token that you used to auth.
	 * @type {?string}
	 */
	public refreshToken!: string | null;

	/**
	 * The client user.
	 * @type {?ClientUser}
	 */
	public user!: ClientUser | null;

	public constructor() {
		super();
	}

	/**
	 * Login to the DogeHouse API.
	 * @param {string} token - The token.
	 * @param {string} refreshToken - The refresh token.
	 */
	public async login(token: string, refreshToken: string): Promise<void> {
		if (!token || !refreshToken) throw new Error('The token and/or the access token is required!');

		this.connection = await raw.connect(token, refreshToken, {
			onConnectionTaken() {
				throw new Error('You can only login on only one account at the same time.');
			},
			url: baseUrl,
		});

		this.user = new ClientUser(this);
		this.rooms = new Collection<string, Room>();
		this.users = new Collection<string, User>();
		this.wrapper = wrap(this.connection);
		this.wrapper.subscribe.newChatMsg((data) => {
			this.emit('message', new Message(this, data.msg));
		});
		this.wrapper.subscribe.userJoinRoom(({ user }) => {
			const useR = new User(this, user);
			this.emit('userJoin', useR);
			this.users.set(useR.id, useR);
		});
		this.wrapper.subscribe.userLeaveRoom(({ userId, roomId }) =>
			this.emit('userLeave', this.users.get(userId), this.rooms.get(roomId)),
		);
		this.wrapper.subscribe.handRaised(({ userId }) => this.emit('handRaised', this.users.get(userId)));
		this.wrapper.subscribe.invitationToRoom(async (data) => await this.emit('invite', data));
		this.token = token;
		this.refreshToken = refreshToken;

		const { rooms } = await this.wrapper.query.getTopPublicRooms();

		rooms.forEach((room) => {
			this.rooms.set(room.id, new Room(this, room));
		});
		this.emit('ready');
	}

	/**
	 * Creates a bot account.
	 * @param {string} username - The username of the bot account.
	 * @returns {Promise<string|null>} The api key.
	 */
	public async createBot(username: string): Promise<string | null> {
		const data = (await this.wrapper.mutation.userCreateBot(username)) as CreateBotResponse;

		if (data.isUsernameTaken) throw new Error(`The username "${username}" is taken`);

		return data.apiKey;
	}

	/**
	 * Gets the bot's credentials.
	 * @param {string} apiKey The api key.
	 * @returns {Promise<BotCredentials>} The bot credentials.
	 */
	public async getBotCredentials(apiKey: string): Promise<BotCredentials> {
		const data = await http.bot.auth(apiKey);

		return data;
	}

	/**
	 * Destroys the WS Connection.
	 */
	public destroy(): void {
		this.connection.close();
		this.user = null;
		this.token = null;
		this.refreshToken = null;

		for (const t of this._timeouts) this.clearTimeout(t);
		for (const i of this._intervals) this.clearInterval(i);
		for (const x of this._immediates) this.clearImmediate(x);

		this._timeouts.clear();
		this._intervals.clear();
		this._immediates.clear();
	}

	/**
	 * Sets a timeout.
	 * @param {Function} fn - The function to execute.
	 * @param {number} delay - Time to delay.
	 * @param {unknown[]} args - The extra args.
	 * @returns {NodeJS.Timeout} The timeout.
	 */
	public setTimeout(fn: (...args: unknown[]) => void, delay: number, ...args: unknown[]): NodeJS.Timeout {
		const timeout = setTimeout(() => {
			fn(...args);

			this._timeouts.delete(timeout);
		}, delay);

		this._timeouts.add(timeout);

		return timeout;
	}

	/**
	 * Sets an interval.
	 * @param {Function} fn - The function to execute.
	 * @param {number} delay - Time to execute.
	 * @param {unknown[]} args - The extra args.
	 * @returns {NodeJS.Timeout} The interval.
	 */
	public setInterval(fn: (...args: unknown[]) => void, delay: number, ...args: unknown[]): NodeJS.Timeout {
		const interval = this.setInterval(fn, delay, args);

		this._intervals.add(interval);

		return interval;
	}

	/**
	 * Sets an immediate.
	 * @param {Function} fn - The function to execute.
	 * @param {unknown[]} args - The extra args.
	 * @returns {NodeJS.Immediate} The immediate.
	 */
	public setImmediate(fn: (...args: unknown[]) => void, ...args: unknown[]): NodeJS.Immediate {
		const immediate = this.setImmediate(fn, ...args);

		this._immediates.add(immediate);

		return immediate;
	}

	/**
	 * Clears a timeout.
	 * @param {NodeJS.Timeout} timeout - The timeout to clear.
	 */
	public clearTimeout(timeout: NodeJS.Timeout): void {
		this.clearTimeout(timeout);
		this._timeouts.delete(timeout);
	}

	/**
	 * Clears an interval.
	 * @param {NodeJS.Timeout} interval - The interval to clear.
	 */
	public clearInterval(interval: NodeJS.Timeout): void {
		this.clearInterval(interval);
		this._intervals.delete(interval);
	}

	/**
	 * Clears an immediate.
	 * @param {NodeJS.Immediate} immediate - The immediate to clear.
	 */
	public clearImmediate(immediate: NodeJS.Immediate): void {
		this.clearImmediate(immediate);
		this._immediates.delete(immediate);
	}
}
