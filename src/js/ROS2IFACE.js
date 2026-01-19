import rclnodejs from 'rclnodejs';

/**
 * @class ROS2Interface
 *
 * @description
 * High-level Node.js abstraction over ROS 2 using rclnodejs.
 *
 * This class is intended to serve as a replacement for roslibjs-style
 * wrappers by providing a clean, promise-based API for:
 *
 * - Topics (publishers & subscriptions)
 * - Services (clients)
 * - Actions (goal, feedback, result)
 * - Parameters
 * - Node lifecycle management
 *
 * The class internally caches ROS entities to avoid duplication and
 * unnecessary DDS allocations.
 */
export default class ROS2Interface {
    /**
     * @param {string} [nodeName='ros2_interface_node']
     * @description Name of the ROS 2 node.
     */
    constructor(
        nodeName = 'ros2_interface_node',
        namespace = '/',
        spinTimeout = 100) {
        this.nodeName = nodeName;
        this.namespace = namespace;
        this.spinTimeout = spinTimeout;

        /** @type {rclnodejs.Node|null} */
        this.node = null;

        /** @type {Map<string, rclnodejs.Publisher>} */
        this.publishers = new Map();

        /** @type {Map<string, Set<rclnodejs.Subscription>>} */
        this.subscriptions = new Map();

        /** @type {Map<string, rclnodejs.Client>} */
        this.clients = new Map();

        /** @type {Map<string, rclnodejs.ActionClient>} */
        this.actionClients = new Map();

        /** @type {boolean} */
        this.isInitialized = false;
    }

    /**
     * Initializes the ROS 2 context and creates the node.
     *
     * This method must be called exactly once before using
     * any publishers, subscriptions, services, or actions.
     *
     * @throws {Error} If initialization fails
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) {
            return;
        }

        try {
            await rclnodejs.init();
            this.node = rclnodejs.Node(this.nodeName, this.namespace);

            // Start processing callbacks
            this.node.spin(this.spinTimeout);

            this.isInitialized = true;
            console.info(`ROS 2 node "${this.nodeName}" initialized.`);
        } catch (err) {
            throw new Error(`ROS 2 initialization failed: ${err.message}`);
        }
    }

    /**
     * Internal guard ensuring the node is ready.
     *
     * @private
     * @throws {Error}
     */
    _checkInit() {
        if (!this.isInitialized || !this.node) {
            throw new Error('ROS2Interface not initialized. Call init() first.');
        }
    }

    /* ------------------------------------------------------------------
     * TOPICS
     * ------------------------------------------------------------------ */

    /**
     * Creates (or retrieves) a cached publisher.
     *
     * @param {string} topicName
     * @param {string} msgType - ROS 2 message type (e.g. "std_msgs/msg/String")
     * @returns {rclnodejs.Publisher}
     */
    createPublisher(topicName, msgType) {
        this._checkInit();

        if (!this.publishers.has(topicName)) {
            const publisher = this.node.createPublisher(msgType, topicName);
            this.publishers.set(topicName, publisher);
        }

        return this.publishers.get(topicName);
    }

    /**
     * Publishes a message to a topic.
     *
     * @param {string} topicName
     * @param {string} msgType
     * @param {object} message
     */
    publish(topicName, msgType, message) {
        const publisher = this.createPublisher(topicName, msgType);
        publisher.publish(message);
    }

    /**
     * Subscribes to a topic.
     *
     * Multiple callbacks may subscribe to the same topic.
     *
     * @param {string} topicName
     * @param {string} msgType
     * @param {(msg: object) => void} callback
     * @returns {rclnodejs.Subscription}
     */
    subscribe(topicName, msgType, callback) {
        this._checkInit();

        const subscription = this.node.createSubscription(
            msgType,
            topicName,
            callback
        );

        if (!this.subscriptions.has(topicName)) {
            this.subscriptions.set(topicName, new Set());
        }

        this.subscriptions.get(topicName).add(subscription);
        return subscription;
    }

    /**
     * Unsubscribes a specific subscription.
     *
     * @param {string} topicName
     * @param {rclnodejs.Subscription} subscription
     */
    unsubscribe(topicName, subscription) {
        const subs = this.subscriptions.get(topicName);
        if (!subs || !subs.has(subscription)) return;

        this.node.destroySubscription(subscription);
        subs.delete(subscription);

        if (subs.size === 0) {
            this.subscriptions.delete(topicName);
        }
    }

    /* ------------------------------------------------------------------
     * SERVICES
     * ------------------------------------------------------------------ */

    /**
     * Calls a ROS 2 service.
     *
     * @param {string} serviceName
     * @param {string} serviceType
     * @param {object} request
     * @param {number} [timeoutMs=2000]
     * @returns {Promise<object>} Service response
     */
    async callService(serviceName, serviceType, request, timeoutMs = 2000) {
        this._checkInit();

        let client = this.clients.get(serviceName);
        if (!client) {
            client = this.node.createClient(serviceType, serviceName);
            this.clients.set(serviceName, client);
        }

        const available = await client.waitForService(timeoutMs);
        if (!available) {
            throw new Error(`Service "${serviceName}" not available.`);
        }

        return client.sendRequest(request);
    }

    /* ------------------------------------------------------------------
     * ACTIONS
     * ------------------------------------------------------------------ */

    /**
     * Sends an action goal and waits for completion.
     *
     * @param {string} actionName
     * @param {string} actionType
     * @param {object} goal
     * @param {(feedback: object) => void} [onFeedback]
     * @param {number} [timeoutMs=2000]
     * @returns {Promise<object>} Action result
     */
    async sendActionGoal(
        actionName,
        actionType,
        goal,
        onFeedback,
        timeoutMs = 2000
    ) {
        this._checkInit();

        let client = this.actionClients.get(actionName);
        if (!client) {
            client = new rclnodejs.ActionClient(
                this.node,
                actionType,
                actionName
            );
            this.actionClients.set(actionName, client);
        }

        const ready = await client.waitForServer(timeoutMs);
        if (!ready) {
            throw new Error(`Action server "${actionName}" not available.`);
        }

        const goalHandle = await client.sendGoal(goal, onFeedback);

        if (!goalHandle.isAccepted()) {
            throw new Error('Action goal rejected.');
        }

        return goalHandle.getResult();
    }

    /* ------------------------------------------------------------------
     * PARAMETERS
     * ------------------------------------------------------------------ */

    /**
     * Declares a parameter if it does not already exist.
     *
     * @param {string} name
     * @param {*} defaultValue
     */
    declareParam(name, defaultValue) {
        this._checkInit();

        if (!this.node.hasParameter(name)) {
            this.node.declareParameter(name, defaultValue);
        }
    }

    /**
     * Sets a parameter value.
     *
     * @param {string} name
     * @param {*} value
     */
    async setParam(name, value) {
        this._checkInit();
        await this.node.setParameter(
            new rclnodejs.Parameter(
                name,
                rclnodejs.ParameterType.PARAMETER_NOT_SET,
                value
            )
        );
    }

    /**
     * Retrieves a parameter value.
     *
     * @param {string} name
     * @returns {*}
     */
    getParam(name) {
        this._checkInit();
        return this.node.getParameter(name)?.value;
    }

    /* ------------------------------------------------------------------
     * SHUTDOWN
     * ------------------------------------------------------------------ */

    /**
     * Gracefully shuts down the ROS 2 node and context.
     *
     * This method destroys all cached entities and stops spinning.
     */
    shutdown() {
        if (!this.isInitialized) return;

        this.publishers.clear();
        this.subscriptions.clear();
        this.clients.clear();
        this.actionClients.clear();

        this.node.destroy();
        rclnodejs.shutdown();

        this.node = null;
        this.isInitialized = false;
    }
}
