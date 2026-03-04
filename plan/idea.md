# Application idea

Money, as peer-to-peer IOUs (I Owe You). Anyone can create their own "money", promissory notes to pay back the value determined in the IOU. This value can be tied to any currency or value standard that participants agree on (commodities, algorithms like 0.5*EUR + 0.5*GOLD, etc.). Default is euros, to start simple.

IOUs are based on trust. If I buy a table from you, you will take my IOU as payment for that table only if you trust that you can use that IOU later to receive back something of same value. Thus on the basic level transactions only work between friends who trust each other.

With *chained transactions* we can expand this trust to people we don't know directly. This works by finding a connection through trusted friends: Alice and Bob trust each other, Bob and Charlie trust each other. With a chained transaction Alice can send an IOU to Charlie that Charlie trusts, even if Alice and Charlie don't trust each other directly. In practice: Alice sends her IOU to Bob, who sends his IOU of same value to Charlie. Now Charlie is happy to trade his table to Alice, as he receives Bob's IOU that he trusts. For Bob the transaction is neutral, as he receives and gives IOUs of same value. These chains can have as many middle connections as needed, and thus assuming there is enough trust given, anyone can transact with anyone else in the network.

There are two central concepts in the application:
- *Debt*: these are the current IOUs you have exchanged with your friends, resulting in a balance that can be positive (your friends owe you) or negative (you owe your friends)
- *Trust*: this is the maximum limit of debt you feel comfortable having with each one of your friends.

Debt balance can only change with your actions (you either send or receive IOUs), while Trust or "credit limit" is needed for automating chained transactions. Chained transactions are allowed only when the balances between every participant don't exceed the limit of debt they are comfortable having with that friend.

Users don't need to define trust when transacting directly with friends: if you accept my 100 € IOU, I don't need to tell the system that my credit limit with you is 100 € or more. The advantage in setting credit limits is twofold: it allows my friends and even people I don't know at all to transact between each other, by having me as a middle node in the transaction. But more crucially for me: it also allows me to transact with people I don't know. And the more trust I have with more people, the more likely it is that there exists a route for transacting with anyone I'd like.

When I'm transacting with people I don't know, the benefit of having automated credit limits is obvious. But when I'm the middleman in a transaction that involves people I don't know at all, it is less obvious. In some cases, it can be even harmful: even with comfortable limits set, it's still safer for me to have no debts at all, than owing 1000 € to friend A and being owed 1000 € by friend B.

In future it's possible to introduce *fees* to motivate users to both set credit limits and also to leave the app running in the background, to enable the network to do chained transactions, even when they themselves are not actively using the app. Fees are small extra cost that the sender of chained IOU can give to the participant in the transaction, similar to fees in cryptocurrencies. The middle nodes can also set their required fees in favour of balancing the debts between their friends: if the transaction would cause their debts to approach credit limits, the fee would be higher, or if the transaction would balance their debts by moving them closer to zero, the fee would be lower or no fee at all.
