//@ts-nocheck
import { Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/scheduler";
const functions = require("firebase-functions");
const admin = require("firebase-admin");
import {
  onDocumentCreated,
} from "firebase-functions/v2/firestore";

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

exports.updatePendingRequests = functions.https.onRequest(async (request, response) => {
  try { 
    const now = Timestamp.now();
    const cutoffTime = new Timestamp(now.seconds - 86400, now.nanoseconds); // 24 hrs ago

    const db = admin.firestore();
    const requestsRef = db.collection("requests");

    // Get all pending requests
    const querySnapshot = await requestsRef.where("status", "==", "pending").get();
    console.log(`Found ${querySnapshot.size} pending requests.`);
    
    const batch = db.batch();

    for (const doc of querySnapshot.docs) { // Use for...of loop
      const { createdAt, hostId, amount } = doc.data();

      // Check if createdAt is older than 2 seconds
      if (createdAt.seconds <= cutoffTime.seconds) {
      
        batch.update(doc.ref, { status: "auto_rejected" });

        // Now get the doc from the 'limits' collection where userId = hostId and update the limit
        const limitRef = db.collection("limits").doc(hostId);

        const limitDoc = await limitRef.get(); // Now async/await works correctly here
        if (limitDoc.exists) {
          const { availableLimit } = limitDoc.data();
    
          const newLimit = availableLimit - amount;
         
          batch.update(limitRef, { availableLimit: newLimit });
        } else {
          console.log("No such document!");
        }
      }
    }

    await batch.commit();
    response.send(`Updated ${querySnapshot.size} pending requests to rejected.`);
  } catch (error) {
    console.error("Error updating requests:", error);
    response.status(500).send("Error updating requests.");
  }
});

exports.scheduleUpdatePendingRequests = onSchedule("every 4 hours",async () => {
  await exports.updatePendingRequests({}, { send: () => {} });
});

exports.sendNotificationOnRequestCreation = onDocumentCreated("requests/{requestId}" ,async (snap) => {
  // Get the newly created request document
  const newRequest = snap.data?.data();

  // Get the userId from the created request
  const userId = newRequest.userId;
  const amount = newRequest.amount
  const desc = newRequest.description
  const hostId = newRequest.hostId

  if (!userId) {
    console.log("No userId field in the request document.");
    return null;
  }

  try {

    const db = admin.firestore();
    // Get the user's document from the users collection
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      console.log(`User document with ID ${userId} not found.`);
      return null;
    }

    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;


    // get the host details from the user collection 

    const host = await db.collection("users").doc(hostId).get()

    if (!host.exists) {
      console.log(`User document with ID ${userId} not found.`);
      return null;
    }

    const hostData = host.data();
    console.log(hostData, "hostData")
    const hostName = hostData.firstName + " " + hostData.lastName

    if (!fcmToken) {
      console.log(`No FCM token for user with ID ${userId}.`);
      return null;
    }

    // Create a notification message payload
    const message = {
      notification: {
        title: `${hostName}`,
        body: `Payment request for ₹${amount} for ${desc}. Please accept or decline`,
      },
      token: fcmToken,  // Send to the user's FCM token
      webpush : {
        fcm_options : {
          link : "https://letspay.netlify.app"
        }
      }
    };

    console.log("Sending notification to user with ID: ", userId);

    // Send the notification via FCM
    const response = await admin.messaging().send(message);
    console.log(`Notification sent successfully: ${response}`);
  } catch (error) {
    console.error("Error sending notification:", error);
  }

  return null;
});

exports.updateCashbackStatus = functions.https.onRequest(async (request, response) => {
  try {
    const { transactionId } = request.query; // Get transactionId from query parameters

    if (!transactionId) {
      response.status(400).send("Transaction ID is required.");
      return;
    }

    const db = admin.firestore();
    const transactionRef = db.collection("transactions").doc(transactionId);

    const transactionDoc = await transactionRef.get();
    const transactionData = transactionDoc.data();
    const hostId = transactionData.hostId;

    if (!transactionDoc.exists) {
      response.status(404).send(`Transaction document with ID ${transactionId} not found.`);
      return;
    }

    await transactionRef.update({ cashbackStatus: "success" });

    // send a notification to the host that the cashback has been credited
    const hostDoc = await db.collection("users").doc(hostId).get();
    const hostData = hostDoc.data();
    const fcmToken = hostData.fcmToken;

    if (!fcmToken) {
      console.log(`No FCM token for user with ID ${hostId}.`);
      return null;
    }

    // Create a notification message payload
    const message = {
      notification: {
        title: "Cashback credited!",
        body: "You have received cashback for a transaction. Check your balance.",
      },
      token: fcmToken,  // Send to the user's FCM token
      webpush : {
        fcm_options : {
          link : "https://letspay.netlify.app"
        }
      }
    };

    console.log("Sending notification to user with ID: ", hostId);

    // Send the notification via FCM
    const notificationResponse = await admin.messaging().send(message);
    console.log(`Notification sent successfully: ${notificationResponse}`);


    response.send(`Updated cashback status of transaction ${transactionId} to success.`);
  } catch (error) {
    console.error("Error updating cashback status:", error);
    response.status(500).send("Error updating cashback status.");
  }
});


exports.sendNotification = functions.https.onRequest(async (request, response) => {
  try {
    const { userId, title, body } = request.query; // Get userId, title, and body from query parameters

    if (!userId) {
      response.status(400).send("User ID is required.");
      return;
    }

    if (!title) {
      response.status(400).send("Title is required.");
      return;
    }

    if (!body) {
      response.status(400).send("Body is required.");
      return;
    }

    const db = admin.firestore();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      response.status(404).send(`User document with ID ${userId} not found.`);
      return;
    }

    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;

    if (!fcmToken) {
      console.log(`No FCM token for user with ID ${userId}.`);
      return null;
    }

    // Create a notification message payload
    const message = {
      notification: {
        title: title,
        body: body,
      },
      token: fcmToken,  // Send to the user's FCM token
      webpush : {
        fcm_options : {
          link : "https://letspay.netlify.app"
        }
      }
    };

    console.log("Sending notification to user with ID: ", userId);

    // Send the notification via FCM
    const response = await admin.messaging().send(message);
    console.log(`Notification sent successfully: ${response}`);

    response.send(`Sent notification to user with ID ${userId}.`);
  } catch (error) {
    console.error("Error sending notification:", error);
    response.status(500).send("Error sending notification.");
  }
});
