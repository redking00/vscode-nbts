import * as crypto from 'crypto';
import { UUID } from "@lumino/coreutils";

const DELIMITER = "<IDS|MSG>";

/**
 * Jupyter message
 * @class
 * @param          [properties]              Message properties
 * @param {Array}  [properties.idents]       ZMQ identities
 * @param {Object} [properties.header]
 * @param {Object} [properties.parent_header]
 * @param {Object} [properties.metadata]
 * @param {Object} [properties.content]
 * @param {Array}  [properties.buffers]        Unparsed message frames
 */
export class Message {

    public idents;
    public header;
    public parent_header;
    public metadata;
    public content;
    public buffers;

    constructor(properties?: any) {
        /**
         * ZMQ identities
         * @member {Array}
         */
        this.idents = properties && properties.idents || [];

        /**
         * @member {Object}
         */
        this.header = properties && properties.header || {};

        /**
         * @member {Object}
         */
        this.parent_header = properties && properties.parent_header || {};

        /**
         * @member {Object}
         */
        this.metadata = properties && properties.metadata || {};

        /**
         * @member {Object}
         */
        this.content = properties && properties.content || {};

        /**
         * Unparsed JMP message frames (any frames after content)
         * @member {Array}
         */
        this.buffers = properties && properties.buffers || [];
    }
    /**
     * Decode message received over a ZMQ socket
     *
     */
    public static decode(messageFrames: any, scheme: any, key: any) {
        // Workaround for Buffer.toString failure caused by exceeding the maximum
        // supported length in V8.
        //
        // See issue #4266 https://github.com/nodejs/node/issues/4266
        // and PR #4394 https://github.com/nodejs/node/pull/4394
        // See issue #35676 https://github.com/nodejs/node/issues/35676
        try {
            return _decode(messageFrames, scheme, key);
        } catch (err) {
            console.log("MESSAGE: DECODE: Error:", err);
        }

        return null;
    }


    respond(socket: any, messageType: any, content: any, metadata: any, protocolVersion: any) {
        var response = new Message();

        response.idents = this.idents;

        response.header = {
            msg_id: UUID.uuid4(),
            username: this.header.username,
            session: this.header.session,
            msg_type: messageType,
        };
        if (this.header && this.header.version) {
            response.header.version = this.header.version;
        }
        if (protocolVersion) {
            response.header.version = protocolVersion;
        }

        response.parent_header = this.header;
        response.content = content || {};
        response.metadata = metadata || {};

        socket.send(response);

        return response;
    }

    public encode(scheme?: any, key?: any) {
        scheme = scheme || "sha256";
        key = key || "";

        var idents = this.idents;

        var header = JSON.stringify(this.header);
        var parent_header = JSON.stringify(this.parent_header);
        var metadata = JSON.stringify(this.metadata);
        var content = JSON.stringify(this.content);

        var signature = "";
        if (key) {
            var hmac = crypto.createHmac(scheme, key);
            var encoding = "utf8";
            hmac.update(Buffer.from(header, encoding as any));
            hmac.update(Buffer.from(parent_header, encoding as any));
            hmac.update(Buffer.from(metadata, encoding as any));
            hmac.update(Buffer.from(content, encoding as any));
            signature = hmac.digest("hex");
        }

        var response = idents.concat([
            DELIMITER, // delimiter
            signature, // HMAC signature
            header, // header
            parent_header, // parent header
            metadata, // metadata
            content, // content
        ]).concat(this.buffers);

        return response;
    }
}



function _decode(messageFrames: any, scheme: any, key: any) {
    scheme = scheme || "sha256";
    key = key || "";

    var i = 0;
    var idents = [];
    for (i = 0; i < messageFrames.length; i++) {
        var frame = messageFrames[i];
        if (frame.toString() === DELIMITER) {
            break;
        }
        idents.push(frame);
    }

    if (messageFrames.length - i < 5) {
        console.log("MESSAGE: DECODE: Not enough message frames", messageFrames);
        return null;
    }

    if (messageFrames[i].toString() !== DELIMITER) {
        console.log("MESSAGE: DECODE: Missing delimiter", messageFrames);
        return null;
    }

    if (key) {
        var obtainedSignature = messageFrames[i + 1].toString();

        var hmac = crypto.createHmac(scheme, key);
        hmac.update(messageFrames[i + 2]);
        hmac.update(messageFrames[i + 3]);
        hmac.update(messageFrames[i + 4]);
        hmac.update(messageFrames[i + 5]);
        var expectedSignature = hmac.digest("hex");

        if (expectedSignature !== obtainedSignature) {
            console.log(
                "MESSAGE: DECODE: Incorrect message signature:",
                "Obtained = " + obtainedSignature,
                "Expected = " + expectedSignature
            );
            return null;
        }
    }

    var message = new Message({
        idents: idents,
        header: toJSON(messageFrames[i + 2]),
        parent_header: toJSON(messageFrames[i + 3]),
        content: toJSON(messageFrames[i + 5]),
        metadata: toJSON(messageFrames[i + 4]),
        buffers: Array.prototype.slice.apply(messageFrames, [i + 6]),
    });

    return message;

    function toJSON(value: any) {
        return JSON.parse(value.toString());
    }
}

