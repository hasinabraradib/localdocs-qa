# TCP vs UDP

Both TCP and UDP sit on top of IP and both use port numbers to reach the right
program. The difference is what they promise on top of that.

## What TCP adds

TCP is connection-oriented and reliable. It numbers every byte, acknowledges
what arrives, retransmits what does not, and hands the bytes to the receiving
application in the order they were sent. It is a stream, not a series of
messages: two sends of 100 bytes may arrive as one read of 200, so the
application needs its own framing. TCP also manages flow control, so a fast
sender cannot drown a slow receiver, and congestion control, so senders back off
when the network is struggling.

## The three-way handshake

A TCP connection opens with three messages. The client sends a SYN carrying its
initial sequence number. The server replies with SYN-ACK, acknowledging the
client's number and supplying its own. The client answers with an ACK. After
those three, both sides have agreed on starting sequence numbers and know the
other can both send and receive. Closing is separate, usually a FIN from each
side with its own acknowledgement.

## What UDP does not do

UDP sends a datagram and forgets it. No handshake, no acknowledgements, no
retransmission, no ordering, no congestion control. A datagram may be lost,
duplicated, or arrive out of order, and the application never finds out unless
it checks. In exchange it is small and immediate: there is no connection setup
delay and no head-of-line blocking, where one lost packet stalls everything
behind it.

## Choosing between them

Use TCP when every byte matters and arrival order matters: web pages, APIs, file
transfers, databases, email. Use UDP when late data is worthless or when you
want to handle recovery yourself: live voice and video, online game state, DNS
lookups, metrics and log shipping. A dropped audio frame is better replaced by a
tiny gap than by a late retransmission.

Modern protocols blur the line. QUIC runs over UDP and rebuilds reliability,
ordering, and congestion control in user space, with independent streams so one
loss does not block the rest.
