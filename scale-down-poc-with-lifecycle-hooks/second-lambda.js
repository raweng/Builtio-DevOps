exports.handler = function(event, context) {

	//Importing AWS SDK for nodejs
	var AWS = require('aws-sdk');
	var sns = new AWS.SNS();

	var Client = require('node-rest-client').Client;

	var q = require("q");

	var options_auth = { user: "basic_auth_user", password: "basic_auth_password" }
	var client = new Client(options_auth);

	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

	var autoscaling = new AWS.AutoScaling();
	var ec2 = new AWS.EC2();

	var instanceData = JSON.parse(event.Records[0].Sns.Message);

	if (instanceData) {
		var snsTopic = SNSTopicArn; //Put SNS topic ARN to trigger second lambda function

		var get_args = {				
			headers: {"some_key": "my_key",
					  "Content-Type": "application/json" } 
		}; // API call arguments to get suspend status

		console.log("instance data: ", instanceData );

		//Enter your API endpoint here. Make sure your response is in JSON.
		client.get("https://myapp.com/suspend?hostname="+instanceData.hostIP, get_args, function(data,response) {
		    
		    var status = data.toString(); 
			status = status.replace(/\\/g , "");
			status = status.replace(/^"(.*)"$/, '$1');
			statusData = JSON.parse(status);

			console.log("statusData :", statusData);				

		    if (!statusData.done) {	 

				var message = JSON.stringify({ default: JSON.stringify({ instanceId: instanceData.instanceId, hostIP: instanceData.hostIP, instanceData: instanceData.instanceData }) });

				var snsParams = {
					Message: message, 
					MessageStructure: 'json',
					TopicArn: snsTopic
			    };

			    return q.ninvoke(sns, 'publish', snsParams)
			    .then(function(data){
			        console.log("Here is data: ", data);	       
			        return data;
			    })
			    .then(function(){
			        context.done();
			    })
			    .catch(function(error){
			        console.log(error);
			    })
			    .done();
		    }

		    var suspendData = { selectedInstance: instanceData.instanceId, instanceData: instanceData.instanceData }

		    console.log("Suspend data: ", suspendData);
		    terminateEC2Instance(suspendData)
		});

		function terminateEC2Instance(suspendData) {	
			var params = {
			  AutoScalingGroupName: suspendData.instanceData.AutoScalingGroupName, 
			  LifecycleActionResult: 'CONTINUE', 
			  LifecycleActionToken: suspendData.instanceData.LifecycleActionToken, 
			  LifecycleHookName: suspendData.instanceData.LifecycleHookName
			};

			return q.ninvoke(autoscaling, 'completeLifecycleAction', params)
			.then(function(data){
			    console.log(data); // successful response
				context.done(null, 'Hello World');  // SUCCESS with message		  		
			})
			.done();
		}
	}
	else {
		context.done(null, 'No instance data.');
	}
};
