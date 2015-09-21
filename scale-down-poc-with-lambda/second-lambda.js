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

		var snsMainTopic = MainSNSTopicArn; //Put SNS topic ARN to trigger first lambda function

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

				var message = JSON.stringify({ default: JSON.stringify({ instanceId: instanceData.instanceId, hostIP: instanceData.hostIP, minCount: instanceData.minCount, desiredCount: instanceData.desiredCount }) });

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

		    var suspendData = { selectedInstance: instanceData.instanceId, minCount: instanceData.minCount, desiredCount: instanceData.desiredCount }

		    console.log("Suspend data: ", suspendData);
		    terminateEC2Instance(suspendData)
		});

		function terminateEC2Instance(suspendData) {	

			var terminateParams = {
				InstanceId: suspendData.selectedInstance,
				ShouldDecrementDesiredCapacity: true
			};
			
			console.log("Terminate params", terminateParams);

			return q.ninvoke(autoscaling, 'terminateInstanceInAutoScalingGroup', terminateParams)
			.then(function(data) {
		  		var finalCount = suspendData.desiredCount - 1;
		  		var minCount = suspendData.minCount;

		  		console.log("finalCount: ", finalCount, " and minCount: ", minCount);
		  		if (finalCount > minCount){
		  			console.log("Invoking main lambda again!");

		  			var message = JSON.stringify({ default: JSON.stringify({ msg: 'invoking second lambda' }) });

					var snsParams = {
						Message: message, 
						MessageStructure: 'json',
						TopicArn: snsMainTopic
				    };

				    return q.ninvoke(sns, 'publish', snsParams)
				    .then(function(data){				        	       
				        return data;
				    })
				    .then(function(){
				    	console.log("Invoked!");
				        context.done();
				    })
				    .catch(function(error){
				        console.log(error);
				    })
				    .done();
		  		}
		  		else {
		  			console.log(data);           
		  			context.done(null, 'Instance terminated.');  // SUCCESS with message
		  		}
			})
			.done();

		}
	}
	else {
		context.done(null, 'No instance data.');
	}
};
